import "server-only";

import type { BaseLang } from "@/lib/i18n";
import { takeRequestSlot } from "./request-quota";
import { HttpError } from "./weddings";
import { boundedRequestBody } from "./request-body";

export { boundedRequestBody as boundedVoiceBody, jsonObject as voiceJsonObject } from "./request-body";

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;
const limits = {
  "browser-invite": { count: 10, seconds: 60 * MINUTE },
  "browser-result": { count: 30, seconds: 30 * MINUTE },
  "phone-call": { count: 10, seconds: DAY },
  "phone-destination": { count: 30, seconds: DAY },
  "makeup-dictate": { count: 10, seconds: DAY },
  "family-dictate": { count: 20, seconds: DAY },
  "family-recap": { count: 30, seconds: DAY },
} as const;

export async function takeVoiceRequest(scope: string, operation: keyof typeof limits) {
  const { count, seconds } = limits[operation];
  if (!(await takeRequestSlot(scope, operation, count, seconds))) {
    throw new HttpError(429, "voice_request_limit");
  }
}

const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

export async function voiceClipForm(req: Request): Promise<{ audio: File; language: BaseLang; weddingId: FormDataEntryValue | null }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new HttpError(400, "audio_clip_required");
  const body = await boundedRequestBody(req, MAX_AUDIO_BYTES + 10_000, "audio_too_large");
  const data = await new Response(body, { headers: { "Content-Type": contentType } }).formData().catch(() => null);
  const audio = data?.get("audio");
  if (!data || !(audio instanceof File) || audio.size === 0) {
    throw new HttpError(400, "audio_clip_required");
  }
  if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, "audio_too_large");
  if (!(await matchesAudioHeader(audio))) throw new HttpError(400, "audio_clip_required");
  const language = data.get("language");
  if (language !== "mr" && language !== "hi" && language !== "en") {
    throw new HttpError(400, "invalid_language");
  }
  return { audio, language, weddingId: data.get("weddingId") };
}

async function matchesAudioHeader(audio: File) {
  const header = Buffer.from(await audio.slice(0, 12).arrayBuffer());
  const type = audio.type.split(";")[0];
  switch (type) {
    case "audio/webm":
    case "video/webm":
      return header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WAVE";
    case "audio/mp4":
    case "audio/x-m4a":
      return header.toString("ascii", 4, 8) === "ftyp";
    case "audio/ogg":
    case "audio/opus":
      return header.toString("ascii", 0, 4) === "OggS";
    case "audio/flac":
      return header.toString("ascii", 0, 4) === "fLaC";
    case "audio/mpeg":
    case "audio/mp3":
    case "audio/aac":
      return header.toString("ascii", 0, 3) === "ID3"
        || (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
    default:
      return false;
  }
}
