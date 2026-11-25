import { after } from "next/server";
import crypto from "node:crypto";
import { botCopy, pickLang } from "@/lib/i18n";
import { escapeHtml, send, sendWithApp } from "@/lib/server/telegram-bot";
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
  const t = botCopy[lang];
  const text = msg.text?.trim() ?? "";

  if (text.startsWith("/start")) {
    const payload = text.split(/\s+/)[1] ?? "";
    if (payload.startsWith("join_")) {
      const code = payload.slice(5);
      const p = await invitePreview(code);
      if (!p) return send(chatId, t.inviteInvalid);
      const couple = `${p.wedding.partner_a} & ${p.wedding.partner_b}`;
      return sendWithApp(chatId, t.invited(escapeHtml(couple), escapeHtml(p.family)), t.joinCta, `/tg?join=${encodeURIComponent(code)}`);
    }
    if (mine.length) {
      const { data: w } = await db().from("weddings").select("partner_a, partner_b").eq("id", mine[0].wedding_id).single();
      return sendWithApp(chatId, t.welcomeBack(escapeHtml(`${w?.partner_a} & ${w?.partner_b}`)), t.openCta, `/tg?wedding=${mine[0].wedding_id}`);
    }
    return sendWithApp(chatId, t.welcome(escapeHtml(from.first_name)), t.startCta, "/tg?flow=create");
  }

  const me = mine[0];
  if (!me) return sendWithApp(chatId, t.notMember, t.startCta, "/tg?flow=create");

  const { data: fam } = await db().from("households").select("name").eq("id", me.household_id).maybeSingle();
  const family = escapeHtml(fam?.name ?? "");

  if (msg.voice) {
    // Stored as a household-private note. Sarvam speech-to-text turns it into text in a later slice.
    await addPriorities(me, [], `🎙️ Voice note (${msg.voice.duration}s) · tg:${msg.voice.file_id}`, "household", "voice");
    return sendWithApp(chatId, t.voiceSoon, t.openCta, `/tg?wedding=${me.wedding_id}`);
  }

  if (text) {
    // Anything typed to the bot becomes a private family note. Sharing it with both families is an explicit choice in the app.
    await addPriorities(me, [], text, "household", "telegram");
    return sendWithApp(chatId, t.saved(family), t.openCta, `/tg?wedding=${me.wedding_id}`);
  }
}
