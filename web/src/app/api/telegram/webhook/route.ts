import { after } from "next/server";
import crypto from "node:crypto";
import { botCopy, pickLang } from "@/lib/i18n";
import { escapeHtml, send, sendWithApp, tg } from "@/lib/server/telegram-bot";
import { processGroup, runAgent } from "@/lib/server/agent";
import { localized } from "@/lib/server/translate";
import { transcribe } from "@/lib/server/sarvam";
import { addPriorities, invitePreview, memberships } from "@/lib/server/weddings";
import { db } from "@/lib/server/supabase";

interface TgMessage {
  message_id: number;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; first_name: string; last_name?: string; language_code?: string; is_bot?: boolean };
  text?: string;
  caption?: string;
  reply_to_message?: { from?: { id: number; is_bot?: boolean } };
  new_chat_members?: { id: number; is_bot?: boolean }[];
  voice?: { file_id: string; duration: number; mime_type?: string };
  audio?: { file_id: string; duration: number; mime_type?: string; file_name?: string };
  video_note?: { file_id: string; duration: number };
  document?: { file_id: string; mime_type?: string; file_name?: string };
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
  } else if (msg?.from && (msg.chat.type === "group" || msg.chat.type === "supergroup")) {
    after(() => handleGroup(msg).catch((e) => console.error("group handler failed", e)));
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

  const speech = speechOf(msg);
  if (speech) {
    // Sarvam Saaras transcribes the note in the speaker's language; the agent then replies.
    await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    let transcript: { transcript: string; languageCode: string | null } | null = null;
    try {
      if ((speech.duration ?? 0) <= 30) transcript = await transcribe(await downloadFile(speech.fileId), speech.name, speech.mime);
    } catch (e) {
      console.error("voice transcription failed", speech.mime, e);
    }
    if (!transcript?.transcript) {
      // Never silent: say what happened, in their language.
      const why = (speech.duration ?? 0) > 30 ? "That voice note is longer than 30 seconds. Please send shorter notes (under 30s) so I can understand them." : "I couldn't make out that voice note. Could you send it again, or type it?";
      return send(chatId, await localized({ en: why, hi: why, mr: why }, lang));
    }
    const note = transcript.transcript;
    const id = await addPriorities(me, [], note, "household", "voice");
    if (transcript && id) {
      await db().from("priorities").update({ transcript: transcript.transcript, transcript_lang: transcript.languageCode }).eq("id", id);
    }
    if (await agentReplied(me.wedding_id, "voice", me.id, note, chatId, true)) return;
    return sendWithApp(chatId, await L((c) => c.voiceSoon), await L((c) => c.openCta), `/tg?wedding=${me.wedding_id}`);
  }

  if (text) {
    // Anything typed to the bot becomes a private family note. Sharing it with both families is an explicit choice in the app.
    // The agent answers (plan questions, web search) and saves real wishes as private family notes.
    // If it is off or fails, the message is saved as a private note and the fixed reply goes out.
    await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    if (await agentReplied(me.wedding_id, "message", me.id, text, chatId)) return;
    await addPriorities(me, [], text, "household", "telegram");
    return sendWithApp(chatId, await L((c) => c.saved(family)), await L((c) => c.openCta), `/tg?wedding=${me.wedding_id}`);
  }
}

/** The agent answers in the sender's language. If it is switched off or fails, the fixed reply is sent instead. */
async function agentReplied(weddingId: string, trigger: "message" | "voice", memberId: string, note: string, chatId: number, noteSaved = false) {
  try {
    const r = await runAgent(weddingId, trigger, { senderMemberId: memberId, note, chatId: String(chatId), noteSaved });
    return r.status === "done" && (r.replied || r.actions.some((a) => a.tool === "send_message" && a.audience === "sender" && String(a.result).startsWith("sent")));
  } catch (e) {
    console.error("agent failed", e);
    return false;
  }
}

/**
 * Every way Telegram can carry speech: a recorded voice note, an audio file sent from the attachment
 * menu (often m4a/mp3), an audio file sent "as a document", or a round video note.
 */
function speechOf(msg: TgMessage): { fileId: string; duration: number | null; mime: string; name: string } | null {
  if (msg.voice) return { fileId: msg.voice.file_id, duration: msg.voice.duration, mime: msg.voice.mime_type ?? "audio/ogg", name: "voice.ogg" };
  if (msg.audio) return { fileId: msg.audio.file_id, duration: msg.audio.duration, mime: msg.audio.mime_type ?? "audio/mpeg", name: msg.audio.file_name ?? "audio.mp3" };
  if (msg.document?.mime_type?.startsWith("audio/")) return { fileId: msg.document.file_id, duration: null, mime: msg.document.mime_type, name: msg.document.file_name ?? "audio" };
  if (msg.video_note) return { fileId: msg.video_note.file_id, duration: msg.video_note.duration, mime: "video/mp4", name: "note.mp4" };
  return null;
}

async function downloadFile(fileId: string): Promise<ArrayBuffer> {
  const f = await tg<{ file_path: string }>("getFile", { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.file_path}`);
  if (!res.ok) throw new Error(`telegram file ${res.status}`);
  return res.arrayBuffer();
}

let botId: number | null = null;
let botUser = "";
async function me() {
  if (!botId) {
    const b = await tg<{ id: number; username: string }>("getMe", {});
    botId = b.id;
    botUser = b.username.toLowerCase();
  }
  return { id: botId, username: botUser };
}

/**
 * A family's own WhatsApp-style group. The couple or a parent links it once with their family's
 * invite code (/start link_CODE comes in automatically from the "Add to your family group" link).
 * After that every message is kept for the agent: it reads them on the heartbeat, or at once when
 * someone mentions the bot or replies to it. The group only ever hears about its own family's notes.
 */
async function handleGroup(msg: TgMessage) {
  const chatId = msg.chat.id;
  const bot = await me();
  const raw = (msg.text ?? msg.caption ?? "").trim();
  const s = db();
  const speech = speechOf(msg);

  if (msg.new_chat_members?.some((m) => m.id === bot.id)) {
    return send(chatId, "Namaste 🙏 I'm VivaahMesh. To connect this group to your family's plan, the couple or a parent sends:\n<code>/link FAMILYCODE</code>\n(the code is on your family's invite card in the app).");
  }

  const cmd = /^\/(start|link)(@\w+)?\s+(?:link_)?([A-Za-z0-9_-]+)/.exec(raw);
  if (cmd) {
    const code = cmd[3];
    const { data: h } = await s.from("households").select("id, wedding_id, name").eq("invite_code", code).maybeSingle();
    if (!h) return send(chatId, "That family code didn't work. Open the app and copy it from your family's invite card.");
    const { data: m } = await s.from("members").select("id, role, is_couple, household_id").eq("wedding_id", h.wedding_id).eq("tg_user_id", msg.from!.id).maybeSingle();
    if (!m || m.household_id !== h.id || !(m.is_couple || m.role === "parent")) {
      return send(chatId, "Only the couple or a parent of this family can connect the group.");
    }
    const { error } = await s.from("channels").upsert(
      { wedding_id: h.wedding_id, household_id: h.id, kind: "telegram_group", chat_id: String(chatId), title: msg.chat.title ?? null, linked_by: m.id },
      { onConflict: "chat_id" },
    );
    if (error) throw error;
    await s.from("events").insert({ wedding_id: h.wedding_id, actor_member_id: m.id, kind: "group_linked", payload: { family: h.name } });
    return send(
      chatId,
      `✅ Connected to the ${escapeHtml(h.name)} plan.\nI'll read what the family says here and keep the plan up to date. Notes stay private to ${escapeHtml(h.name)} unless you ask me to share them.\nAsk me anything: mention @${bot.username} or reply to me.\n\n(If I can't see normal messages, make me an admin of this group.)`,
    );
  }

  const { data: ch } = await s.from("channels").select("id, wedding_id").eq("chat_id", String(chatId)).maybeSingle();
  if (!ch) {
    if (raw.toLowerCase().includes(`@${bot.username}`)) return send(chatId, "This group isn't connected yet. The couple or a parent sends <code>/link FAMILYCODE</code>.");
    return;
  }
  if (msg.from!.is_bot) return;

  let text = raw;
  let kind: "text" | "voice" = "text";
  if (!text && speech && (speech.duration ?? 0) <= 30) {
    try {
      text = (await transcribe(await downloadFile(speech.fileId), speech.name, speech.mime)).transcript;
      kind = "voice";
    } catch (e) {
      console.error("group voice transcription failed", e);
    }
  }
  if (!text) return;
  const fromName = [msg.from!.first_name, msg.from!.last_name].filter(Boolean).join(" ");
  await s.from("group_messages").insert({ channel_id: ch.id, wedding_id: ch.wedding_id, from_name: fromName, from_tg_id: msg.from!.id, text: text.slice(0, 2000), kind });

  const mentioned = text.toLowerCase().includes(`@${bot.username}`) || (msg.reply_to_message?.from?.id === bot.id);
  if (mentioned) {
    await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    await processGroup(ch.id, true);
  }
}
