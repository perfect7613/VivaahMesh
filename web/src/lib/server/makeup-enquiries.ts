import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "./supabase";
import { HttpError } from "./weddings";
import type { Lang } from "@/lib/i18n";

type Enquiry = {
  id: string;
  function_kind: string;
  proposal_id: string;
  artist_name: string;
  due_minute: number;
  status: "open" | "confirmed" | "withdrawn";
  expires_at: string;
  reply_source: "typed" | "voice" | null;
  reply_wording: string | null;
};

const SELECT = "id,function_kind,proposal_id,artist_name,due_minute,status,expires_at,reply_source,reply_wording";
const TOKEN = /^[\w-]{43}$/;
const MAX_CLIP_BYTES = 3 * 1024 * 1024;
const LANGUAGE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };

function sign(payload: string) {
  const key = process.env.OPS_SECRET;
  if (!key || key.length < 32) throw new HttpError(503, "makeup_reply_unconfigured");
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function tokenFor(id: string) {
  return sign(`makeup-reply:${id}`);
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function expired(enquiry: Enquiry) {
  return Date.parse(enquiry.expires_at) <= Date.now();
}

export async function makeupEnquiries(weddingId: string) {
  const { data, error } = await db().from("makeup_enquiries").select(SELECT).eq("wedding_id", weddingId);
  if (error) throw error;
  return ((data ?? []) as Enquiry[]).map((row) => ({
    functionKind: row.function_kind,
    proposalId: row.proposal_id,
    artist: row.artist_name,
    readyBy: row.due_minute,
    status: row.status,
    expired: expired(row),
    reply: row.reply_source && row.reply_wording ? { source: row.reply_source, wording: row.reply_wording } : null,
  }));
}

export async function askMakeupArtist(input: {
  weddingId: string; memberId: string; functionKind: string; proposalId: string; artist: string; readyBy: number;
}) {
  const s = db();
  const id = randomUUID();
  const { error } = await s.from("makeup_enquiries").upsert({
    id,
    wedding_id: input.weddingId,
    requested_by: input.memberId,
    function_kind: input.functionKind,
    proposal_id: input.proposalId,
    artist_name: input.artist,
    due_minute: input.readyBy,
    token_hash: tokenHash(tokenFor(id)),
  }, { onConflict: "wedding_id,function_kind,proposal_id,due_minute", ignoreDuplicates: true });
  if (error) throw error;
  const scope = () => s.from("makeup_enquiries").select(SELECT).eq("wedding_id", input.weddingId)
    .eq("function_kind", input.functionKind).eq("proposal_id", input.proposalId).eq("due_minute", input.readyBy).single();
  const existing = await scope();
  if (existing.error) throw existing.error;
  let enquiry = existing.data as Enquiry;
  if (enquiry.status === "open" && expired(enquiry)) {
    const fresh = await s.from("makeup_enquiries").update({
      id, token_hash: tokenHash(tokenFor(id)), expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }).eq("id", enquiry.id).eq("status", "open").lte("expires_at", new Date().toISOString()).select(SELECT).maybeSingle();
    if (fresh.error) throw fresh.error;
    if (fresh.data) enquiry = fresh.data as Enquiry;
    else {
      const current = await scope();
      if (current.error) throw current.error;
      enquiry = current.data as Enquiry;
    }
  }
  return {
    replyPath: enquiry.status === "open" ? `/makeup-reply/${tokenFor(enquiry.id)}` : null,
    status: enquiry.status,
  };
}

export async function makeupReplyView(token: string) {
  if (!TOKEN.test(token)) throw new HttpError(404, "makeup_reply_not_found");
  const { data, error } = await db().from("makeup_enquiries").select(SELECT)
    .eq("token_hash", tokenHash(token)).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "makeup_reply_not_found");
  const enquiry = data as Enquiry;
  if (expired(enquiry)) throw new HttpError(410, "makeup_reply_expired");
  return {
    status: enquiry.status, artist: enquiry.artist_name, readyBy: enquiry.due_minute, functionKind: enquiry.function_kind,
  };
}

function voiceDraft(token: string, wording: string) {
  return sign(`makeup-voice:${token}:${wording}`);
}

export async function recordMakeupReply(token: string, input: Record<string, unknown>) {
  const view = await makeupReplyView(token);
  const { confirms, voiceDraftToken } = input;
  const wording = typeof input.wording === "string" ? input.wording.trim() : "";
  if (typeof confirms !== "boolean" || !wording || wording.length > 1000) throw new HttpError(400, "invalid_makeup_reply");
  if (view.status !== "open") throw new HttpError(409, "makeup_reply_already_recorded");
  const isVoice = typeof voiceDraftToken === "string" && TOKEN.test(voiceDraftToken)
    && timingSafeEqual(Buffer.from(voiceDraftToken), Buffer.from(voiceDraft(token, wording)));
  const { data: status, error } = await db().rpc("apply_makeup_reply", {
    p_token_hash: tokenHash(token), p_confirms: confirms, p_wording: wording, p_source: isVoice ? "voice" : "typed",
  });
  if (error) throw error;
  if (!status) throw new HttpError(409, "makeup_reply_already_recorded");
  return { status };
}

export async function dictateMakeupReply(token: string, req: Request) {
  if ((await makeupReplyView(token)).status !== "open") throw new HttpError(409, "makeup_reply_already_recorded");
  if (Number(req.headers.get("content-length")) > MAX_CLIP_BYTES + 10_000) throw new HttpError(413, "audio_too_large");
  const form = await req.formData().catch(() => null);
  const clip = form?.get("audio");
  const language = form?.get("language");
  if (!(clip instanceof File) || !clip.size || !/^(?:audio\/(?:webm|mp4|ogg)|video\/webm)$/.test(clip.type.split(";")[0])) {
    throw new HttpError(400, "audio_clip_required");
  }
  if (clip.size > MAX_CLIP_BYTES) throw new HttpError(413, "audio_too_large");
  if (language !== "en" && language !== "hi" && language !== "mr") throw new HttpError(400, "invalid_language");
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new HttpError(503, "sarvam_models_unconfigured");
  const body = new FormData();
  body.append("file", clip, clip.name);
  body.append("language_code", LANGUAGE[language]);
  body.append("mode", "transcribe");
  const response = await fetch("https://api.sarvam.ai/v2/dictate", {
    method: "POST", headers: { "api-subscription-key": key }, body,
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(24_000),
  }).catch(() => null);
  if (!response?.ok) throw new HttpError(502, "dictate_request_failed");
  const data: { transcript?: unknown } | null = await response.json().catch(() => null);
  const text = typeof data?.transcript === "string" ? data.transcript.trim() : "";
  if (!text || text.length > 1000) throw new HttpError(422, "dictate_no_short_transcript");
  return { text, voiceDraftToken: voiceDraft(token, text) };
}

export async function makeupResponse(run: () => Promise<unknown>) {
  try {
    return Response.json(await run(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    console.error(error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
