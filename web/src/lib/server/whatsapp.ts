import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http-error";
import { whatsappEnabled } from "./flags";
import { transcribe } from "./sarvam";
import { db } from "./supabase";

const groupPattern = /^\d{5,24}(?:-\d{5,24})?@g\.us$/;
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const codePattern = /^(?:[a-f0-9]{10}|[a-f0-9]{32})$/;
const maxAge = 15 * 60 * 1000;

const notice = {
  en: { joined: "Someone joined your family on VivaahMesh.", plan: "The wedding plan has changed." },
  hi: { joined: "विवाहमेश पर आपके परिवार में एक नया सदस्य जुड़ा है।", plan: "शादी की योजना में बदलाव हुआ है।" },
  mr: { joined: "विवाहमेशवर तुमच्या कुटुंबात एक नवीन सदस्य सामील झाला आहे.", plan: "लग्नाच्या योजनेत बदल झाला आहे." },
};
type Lang = keyof typeof notice;

function lang(value: unknown): value is Lang {
  return value === "en" || value === "hi" || value === "mr";
}

export function bridgeAuthorized(secret: string | undefined, header: string | null) {
  if (!secret || secret.length < 32 || !header || header.length > 256) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(secret), digest(header));
}

async function eligibleHousehold(householdId: string, weddingId: string) {
  const result = await db().from("households").select("side")
    .eq("id", householdId).eq("wedding_id", weddingId).maybeSingle();
  if (result.error) throw result.error;
  return result.data && await whatsappEnabled(weddingId, householdId, result.data.side);
}

async function link(group: string, code: unknown, language: unknown) {
  if (typeof code !== "string" || !codePattern.test(code) || !lang(language)) {
    throw new HttpError(400, "invalid_link");
  }
  const result = await db().from("households").select("id, wedding_id, side").eq("invite_code", code).maybeSingle();
  if (result.error) throw result.error;
  const household = result.data;
  if (!household || !await whatsappEnabled(household.wedding_id, household.id, household.side)) {
    return { status: "ignored" };
  }
  const { data, error } = await db().rpc("link_whatsapp_household", {
    p_chat: group, p_household: household.id, p_code: code, p_language: language,
  });
  if (error) throw error;
  return { status: data ? "linked" : "ignored" };
}

async function takeNotice(channelId: string, language: Lang) {
  const { data, error } = await db().from("whatsapp_updates").select("id, kind")
    .eq("channel_id", channelId).order("id").limit(1).maybeSingle();
  if (error) throw error;
  const kind: unknown = data?.kind;
  if (!data || (kind !== "joined" && kind !== "plan")) return { status: "empty" };

  const link = new URL(process.env.WHATSAPP_PLAN_URL ?? "");
  if (link.protocol !== "https:" || link.username || link.password) throw new Error("invalid WhatsApp plan URL");
  const claimed = await db().from("whatsapp_updates").delete().eq("channel_id", channelId).eq("id", data.id).select("id");
  if (claimed.error) throw claimed.error;
  if (!claimed.data?.length) return { status: "empty" };
  return { status: "notice", message: `${notice[language][kind]} ${link.href}` };
}

function voiceBytes(value: unknown) {
  if (typeof value !== "string" || value.length > 1_398_104 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new HttpError(400, "invalid_audio");
  }
  const audio = Buffer.from(value, "base64");
  if (audio.length < 28 || audio.length > 1_048_576 || audio.subarray(0, 4).toString() !== "OggS") {
    throw new HttpError(400, "invalid_audio");
  }
  return Uint8Array.from(audio).buffer;
}

export async function receiveWhatsApp(body: Record<string, unknown>) {
  const { group, action, messageId, sentAt } = body;
  if (typeof group !== "string" || !groupPattern.test(group)) throw new HttpError(400, "invalid_group");
  if (action !== "poll" && (typeof sentAt !== "number" || !Number.isFinite(sentAt) ||
    sentAt < Date.now() - maxAge || sentAt > Date.now() + 60_000)) return { status: "ignored" };
  if (action === "link") return link(group, body.code, body.language);

  const found = await db().from("channels").select("id, wedding_id, household_id, whatsapp_language, created_at")
    .eq("chat_id", group).eq("kind", "whatsapp_group").maybeSingle();
  if (found.error) throw found.error;
  const channel = found.data;
  if (!channel || !lang(channel.whatsapp_language) || !await eligibleHousehold(channel.household_id, channel.wedding_id)) {
    return { status: "ignored" };
  }
  if (action === "poll") return takeNotice(channel.id, channel.whatsapp_language);
  if (typeof sentAt !== "number" || Math.floor(sentAt / 1000) <= Math.floor(Date.parse(channel.created_at) / 1000)) return { status: "ignored" };
  if (typeof messageId !== "string" || !idPattern.test(messageId)) throw new HttpError(400, "invalid_message");
  if (action === "voice_check") return { status: "ready" };
  if (action !== "text" && action !== "voice") throw new HttpError(400, "invalid_action");
  const author = typeof body.author === "string" ? body.author.trim().slice(0, 100) : "";
  let note = typeof body.text === "string" ? body.text.trim().slice(0, 3000) : "";
  if (note.startsWith("/link")) return { status: "ignored" };
  let transcript: Awaited<ReturnType<typeof transcribe>> | null = null;

  if (action === "voice") {
    const audio = voiceBytes(body.audio);
    const claimed = await db().rpc("claim_whatsapp_voice", { p_channel: channel.id, p_message: messageId });
    if (claimed.error) throw claimed.error;
    if (!claimed.data) return { status: "ignored" };
    // Paid transcriptions receive one attempt per message even when the outcome is uncertain.
    transcript = await transcribe(audio);
    note = transcript.transcript.slice(0, 3000);
  }
  if (!note) return { status: "ignored" };
  const saved = await db().from("priorities").insert({
    wedding_id: channel.wedding_id, household_id: channel.household_id,
    source: "whatsapp", visibility: "household", kind: "note", note,
    author_name: author || null, whatsapp_channel_id: channel.id, whatsapp_message_id: messageId,
    transcript: transcript ? note : null, transcript_lang: transcript?.languageCode ?? null,
  });
  if (saved.error && saved.error.code !== "23505") throw saved.error;
  return { status: "saved" };
}
