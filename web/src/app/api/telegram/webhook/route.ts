import { after } from "next/server";
import { hasTelegramWebhookSecret } from "@/lib/server/telegram-auth";
import { base, botCopy, pickLang } from "@/lib/i18n";
import { downloadTelegramAudio, escapeHtml, send, sendWithApp, telegramSpeech, tg, type TelegramAudioMessage } from "@/lib/server/telegram-bot";
import { jsonObject } from "@/lib/server/request-body";
import { takeAgentRequest } from "@/lib/server/request-quota";
import { processGroup, runAgent } from "@/lib/server/agent";
import { publicSearchTerms } from "@/lib/server/agent-scope";
import { localized } from "@/lib/server/translate";
import { transcribe } from "@/lib/server/sarvam";
import { addPriorities, canManageWedding, invitePreview, memberships, HttpError } from "@/lib/server/weddings";
import { db } from "@/lib/server/supabase";

interface TgMessage extends TelegramAudioMessage {
  message_id: number;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; first_name: string; last_name?: string; language_code?: string; is_bot?: boolean };
  text?: string;
  caption?: string;
  reply_to_message?: { from?: { id: number; is_bot?: boolean } };
  new_chat_members?: { id: number; is_bot?: boolean }[];

}

/**
 * Telegram webhook. Verified with the secret token header set in setWebhook.
 * Replies within a few seconds by returning quickly and doing the work in after().
 */
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!hasTelegramWebhookSecret(req, "x-telegram-bot-api-secret-token")) {
    return new Response("forbidden", { status: 403 });
  }
  let update: { message?: TgMessage };
  try {
    update = await jsonObject(req, 128 * 1024);
  } catch (e) {
    return new Response("bad update", { status: e instanceof HttpError ? e.status : 400 });
  }
  const msg = update.message;
  if (!msg?.chat || !msg.from || msg.from.is_bot) return Response.json({ ok: true });
  if (msg.chat.type === "private" && msg.from.id === msg.chat.id) {
    after(() => handle(msg).catch(() => console.error("bot handler failed")));
  } else if (msg.chat.type === "group" || msg.chat.type === "supergroup") {
    after(() => handleGroup(msg).catch(() => console.error("group handler failed")));
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
      const p = await invitePreview(code, from.id);
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

  const speech = telegramSpeech(msg);
  if (speech) {
    if ((speech.duration ?? 0) <= 30 && !(await takeAgentRequest(from.id))) {
      return send(chatId, botCopy[base(lang)].agentRequestLimit);
    }
    // Sarvam Saaras transcribes the note in the speaker's language; the agent then replies.
    await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    let transcript: { transcript: string; languageCode: string | null } | null = null;
    try {
      if ((speech.duration ?? 0) <= 30) transcript = await transcribe(await downloadTelegramAudio(speech.fileId, speech.fileSize), speech.name, speech.mime);
    } catch {
      console.error("voice transcription failed");
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
    // Public searches are explicit. Keep a failed search separate from the private family notes.
    const searchCommand = /^\/search(?:\s|$)/i.test(text);
    if (searchCommand && !publicSearchTerms(text)) return send(chatId, await L((c) => c.searchUsage));
    if (!(await takeAgentRequest(from.id))) return send(chatId, botCopy[base(lang)].agentRequestLimit);
    await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    if (await agentReplied(me.wedding_id, "message", me.id, text, chatId)) return;
    if (searchCommand) return send(chatId, await L((c) => c.searchUnavailable));
    await addPriorities(me, [], text, "household", "telegram");
    return sendWithApp(chatId, await L((c) => c.saved(family)), await L((c) => c.openCta), `/tg?wedding=${me.wedding_id}`);
  }
}

/** The agent answers in the sender's language. If it is switched off or fails, the fixed reply is sent instead. */
async function agentReplied(weddingId: string, trigger: "message" | "voice", memberId: string, note: string, chatId: number, noteSaved = false) {
  try {
    const r = await runAgent(weddingId, trigger, { senderMemberId: memberId, note, chatId: String(chatId), noteSaved });
    return r.status === "done" && r.replied;
  } catch {
    console.error("agent failed");
    return false;
  }
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
 * A family's Telegram group. A verified family manager who administers the group can link it
 * from the Mini App. The payload identifies the family without carrying an invitation.
 * After that every message is kept for the agent: it reads them on the heartbeat, or at once when
 * someone mentions the bot or replies to it. The group only ever hears about its own family's notes.
 */
async function handleGroup(msg: TgMessage) {
  const chatId = msg.chat.id;
  const bot = await me();
  const raw = (msg.text ?? msg.caption ?? "").trim();
  const s = db();
  const speech = telegramSpeech(msg);

  if (msg.new_chat_members?.some((m) => m.id === bot.id)) {
    return send(chatId, "Namaste 🙏 I'm VivaahMesh. Open the VivaahMesh Mini App and use Add to your family group to connect this chat.");
  }

  const cmd = /^\/start(?:@(\w+))?\s+link_([a-f0-9-]{36})$/i.exec(raw);
  if (cmd && (!cmd[1] || cmd[1].toLowerCase() === bot.username)) {
    const membershipsForSender = await memberships(msg.from!.id);
    const member = membershipsForSender.find((m) => m.household_id === cmd[2].toLowerCase());
    if (!member || !canManageWedding(member)) return send(chatId, "A family manager can connect this group from the Mini App.");
    const admins = await tg<{ user: { id: number } }[]>("getChatAdministrators", { chat_id: chatId });
    if (!admins.some((admin) => admin.user.id === msg.from!.id)) {
      return send(chatId, "A group admin must connect this group from the Mini App.");
    }
    const { data: linked, error } = await s.from("channels").upsert(
      { wedding_id: member.wedding_id, household_id: member.household_id, kind: "telegram_group", chat_id: String(chatId), title: msg.chat.title ?? null, linked_by: member.id },
      { onConflict: "chat_id", ignoreDuplicates: true },
    ).select("id").maybeSingle();
    if (error) throw error;
    if (!linked) {
      const { data: existing } = await s.from("channels").select("household_id").eq("chat_id", String(chatId)).single();
      return send(chatId, existing?.household_id === member.household_id
        ? "This group is already connected to your family."
        : "This group is already connected to another family.");
    }
    await s.from("events").insert({ wedding_id: member.wedding_id, actor_member_id: member.id, kind: "group_linked" });
    return send(
      chatId,
      `✅ Connected to your family plan. I read messages sent by members of this family who have joined VivaahMesh. Mention @${bot.username} or reply to me to ask a question. Family notes saved from this group stay in your household's plan. For public vendor research, message me privately with /search followed by public search terms.\n\nIf I can't see normal messages, make me an admin of this group.`,
    );
  }

  const { data: ch } = await s.from("channels").select("id, wedding_id, household_id").eq("chat_id", String(chatId)).maybeSingle();
  if (!ch) {
    if (raw.toLowerCase().includes(`@${bot.username}`)) return send(chatId, "This group is awaiting connection from the Mini App.");
    return;
  }
  const { data: sender } = await s.from("members").select("id,language").eq("tg_user_id", msg.from!.id)
    .eq("wedding_id", ch.wedding_id).eq("household_id", ch.household_id).maybeSingle();
  if (!sender) return;

  let text = raw;
  let kind: "text" | "voice" = "text";
  if (!text && speech && (speech.duration ?? 0) <= 30) {
    if (!(await takeAgentRequest(msg.from!.id))) return send(chatId, botCopy[base(pickLang(sender.language))].agentRequestLimit);
    try {
      text = (await transcribe(await downloadTelegramAudio(speech.fileId, speech.fileSize), speech.name, speech.mime)).transcript;
      kind = "voice";
    } catch {
      console.error("group voice transcription failed");
    }
  }
  if (!text) return;
  const fromName = [msg.from!.first_name, msg.from!.last_name].filter(Boolean).join(" ");
  await s.from("group_messages").insert({ channel_id: ch.id, wedding_id: ch.wedding_id, from_name: fromName, from_tg_id: msg.from!.id, text: text.slice(0, 2000), kind });

  const mentioned = text.toLowerCase().includes(`@${bot.username}`) || (msg.reply_to_message?.from?.id === bot.id);
  if (mentioned) {
    if (kind !== "voice" && !(await takeAgentRequest(msg.from!.id))) {
      return send(chatId, botCopy[base(pickLang(sender.language))].agentRequestLimit);
    }
    await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    await processGroup(ch.id, true);
  }
}
