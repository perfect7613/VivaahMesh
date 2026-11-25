import { after } from "next/server";
import crypto from "node:crypto";
import { botCopy, pickLang } from "@/lib/i18n";
import { escapeHtml, send, sendWithApp, tg } from "@/lib/server/telegram-bot";
import { runAgent } from "@/lib/server/agent";
import { localized } from "@/lib/server/translate";
import { transcribe } from "@/lib/server/sarvam";
import { addPriorities, invitePreview, memberships } from "@/lib/server/weddings";
import { db } from "@/lib/server/supabase";

interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name: string; language_code?: string };
  text?: string;
  voice?: { file_id: string; duration: number };
}

/**
 * Telegram webhook. Verified with the secret token header set in setWebhook.
 * Replies within a few seconds by returning quickly and doing the work in after().
 */
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new Response("forbidden", { status: 403 });
  }
  const update = (await req.json()) as { message?: TgMessage };
  const msg = update.message;
  if (msg?.from && msg.chat.type === "private") {
    after(() => handle(msg).catch((e) => console.error("bot handler failed", e)));
  }
  return Response.json({ ok: true });
}

async function handle(msg: TgMessage) {
  const from = msg.from!;
  const chatId = msg.chat.id;
  const mine = await memberships(from.id);
  const lang = pickLang(mine[0]?.language ?? from.language_code);
  // Hand-written copy for Marathi, Hindi and English; Sarvam Translate for every other language.
  type Copy = (typeof botCopy)["en"];
  const L = (pick: (c: Copy) => string) => localized({ en: pick(botCopy.en), hi: pick(botCopy.hi), mr: pick(botCopy.mr) }, lang);
  const text = msg.text?.trim() ?? "";

  if (text.startsWith("/start")) {
    const payload = text.split(/\s+/)[1] ?? "";
    if (payload.startsWith("join_")) {
      const code = payload.slice(5);
      const p = await invitePreview(code);
      if (!p) return send(chatId, await L((c) => c.inviteInvalid));
      const couple = `${p.wedding.partner_a} & ${p.wedding.partner_b}`;
      return sendWithApp(chatId, await L((c) => c.invited(escapeHtml(couple), escapeHtml(p.family))), await L((c) => c.joinCta), `/tg?join=${encodeURIComponent(code)}`);
    }
    if (mine.length) {
      const { data: w } = await db().from("weddings").select("partner_a, partner_b").eq("id", mine[0].wedding_id).single();
      return sendWithApp(chatId, await L((c) => c.welcomeBack(escapeHtml(`${w?.partner_a} & ${w?.partner_b}`))), await L((c) => c.openCta), `/tg?wedding=${mine[0].wedding_id}`);
    }
    return sendWithApp(chatId, await L((c) => c.welcome(escapeHtml(from.first_name))), await L((c) => c.startCta), "/tg?flow=create");
  }

  const me = mine[0];
  if (!me) return sendWithApp(chatId, await L((c) => c.notMember), await L((c) => c.startCta), "/tg?flow=create");

  const { data: fam } = await db().from("households").select("name").eq("id", me.household_id).maybeSingle();
  const family = escapeHtml(fam?.name ?? "");

  if (msg.voice) {
    // Sarvam Saaras transcribes the note in the speaker's language; the agent then replies.
    await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    let transcript: { transcript: string; languageCode: string | null } | null = null;
    try {
      if (msg.voice.duration <= 30) transcript = await transcribe(await downloadFile(msg.voice.file_id));
    } catch (e) {
      console.error("voice transcription failed", e);
    }
    const note = transcript?.transcript || `🎙️ Voice note (${msg.voice.duration}s)`;
    const id = await addPriorities(me, [], note, "household", "voice");
    if (transcript && id) {
      await db().from("priorities").update({ transcript: transcript.transcript, transcript_lang: transcript.languageCode }).eq("id", id);
    }
    if (await agentReplied(me.wedding_id, "voice", me.id, note)) return;
    return sendWithApp(chatId, await L((c) => c.voiceSoon), await L((c) => c.openCta), `/tg?wedding=${me.wedding_id}`);
  }

  if (text) {
    // Anything typed to the bot becomes a private family note. Sharing it with both families is an explicit choice in the app.
    await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    await addPriorities(me, [], text, "household", "telegram");
    if (await agentReplied(me.wedding_id, "message", me.id, text)) return;
    return sendWithApp(chatId, await L((c) => c.saved(family)), await L((c) => c.openCta), `/tg?wedding=${me.wedding_id}`);
  }
}

/** The agent answers in the sender's language. If it is switched off or fails, the fixed reply is sent instead. */
async function agentReplied(weddingId: string, trigger: "message" | "voice", memberId: string, note: string) {
  try {
    const r = await runAgent(weddingId, trigger, { senderMemberId: memberId, note });
    return r.status === "done" && r.actions.some((a) => a.tool === "send_message" && a.audience === "sender" && String(a.result).startsWith("sent"));
  } catch (e) {
    console.error("agent failed", e);
    return false;
  }
}

async function downloadFile(fileId: string): Promise<ArrayBuffer> {
  const f = await tg<{ file_path: string }>("getFile", { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.file_path}`);
  if (!res.ok) throw new Error(`telegram file ${res.status}`);
  return res.arrayBuffer();
}
