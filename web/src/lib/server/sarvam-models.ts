import "server-only";

import type { BaseLang as Lang } from "@/lib/i18n";
import { dictatedDinnerTime } from "@/lib/family-plan";
import { HttpError } from "./weddings";

const CODE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };

async function modelJson(path: string, body: string | FormData) {
  const key = process.env.SARVAM_MODEL_API_KEY || process.env.SARVAM_API_KEY;
  if (!key) throw new HttpError(503, "sarvam_models_unconfigured");
  const headers = new Headers({ "api-subscription-key": key, Accept: "application/json" });
  if (typeof body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(`https://api.sarvam.ai${path}`, {
    method: "POST",
    headers,
    body,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(24_000),
  }).catch(() => null);
  if (response?.status === 429) throw new HttpError(429, "sarvam_rate_limited");
  if (!response?.ok) throw new HttpError(502, "sarvam_model_request_failed");
  const json: unknown = await response.json().catch(() => null);
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new HttpError(502, "sarvam_model_response_invalid");
  }
  return json as Record<string, unknown>;
}

export async function dictateClip(audio: File, lang: Lang) {
  const form = new FormData();
  form.append("file", audio, audio.name);
  form.append("language_code", CODE[lang]);
  form.append("mode", "transcribe");
  form.append("output_rules", 'Return only a JSON object with one key "dinner_time". Its value is the requested dinner start time as HH:mm in ASCII digits using the 24-hour clock. Return null if the dinner start time or time of day is unclear.');
  const output = await modelJson("/v2/dictate", form);
  const transcript = typeof output.transcript === "string" ? output.transcript.trim() : "";
  const text = typeof output.text === "string" ? output.text.trim() : "";
  if (!transcript || !text || transcript.length > 4000 || text.length > 4000) {
    throw new HttpError(422, "dictate_no_short_transcript");
  }
  const extracted = output.output as { text?: unknown } | null | undefined;
  return { text, transcript, dinnerTime: dictatedDinnerTime(extracted?.text) };
}

export async function bulbulRecap(text: string, lang: Lang) {
  if (!text || text.length > 2500) throw new HttpError(409, "recap_unavailable");
  const output = await modelJson("/text-to-speech", JSON.stringify({
    text,
    language_code: CODE[lang],
    model: "bulbul:v3",
    speaker: "shubh",
    output_audio_codec: "wav",
  }));
  const audio = Array.isArray(output.audios) ? output.audios[0] : null;
  if (typeof audio !== "string" || audio.length > 6_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
    throw new HttpError(502, "bulbul_audio_invalid");
  }
  return audio;
}
