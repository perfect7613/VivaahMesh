import "server-only";

import { boundedRequestBody } from "./request-body";

const TELEGRAM = "https://api.telegram.org";
export const MAX_TELEGRAM_AUDIO_BYTES = 3 * 1024 * 1024;

function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error("telegram_unconfigured");
  return token;
}

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  try {
    const res = await fetch(`${TELEGRAM}/bot${botToken()}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error("telegram_http_error");
    const bytes = await boundedRequestBody(res, 128 * 1024);
    const json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { ok?: boolean; result?: T } | null;
    if (json?.ok !== true || json.result === undefined) throw new Error("telegram_invalid_response");
    return json.result;
  } catch {
    throw new Error("telegram_request_failed");
  }
}

export interface TelegramAudioMessage {
  voice?: { file_id: string; file_size?: number; duration: number; mime_type?: string };
  audio?: { file_id: string; file_size?: number; duration: number; mime_type?: string; file_name?: string };
  video_note?: { file_id: string; file_size?: number; duration: number };
  document?: { file_id: string; file_size?: number; mime_type?: string; file_name?: string };
}

/**
 * Every way Telegram can carry speech: a recorded voice note, an audio file sent from the attachment
 * menu (often m4a/mp3), an audio file sent "as a document", or a round video note.
 */
export function telegramSpeech(msg: TelegramAudioMessage): { fileId: string; duration: number | null; fileSize?: number; mime: string; name: string } | null {
  if (msg.voice) return { fileId: msg.voice.file_id, fileSize: msg.voice.file_size, duration: msg.voice.duration, mime: msg.voice.mime_type ?? "audio/ogg", name: "voice.ogg" };
  if (msg.audio) return { fileId: msg.audio.file_id, fileSize: msg.audio.file_size, duration: msg.audio.duration, mime: msg.audio.mime_type ?? "audio/mpeg", name: msg.audio.file_name ?? "audio.mp3" };
  if (msg.document?.mime_type?.startsWith("audio/")) return { fileId: msg.document.file_id, fileSize: msg.document.file_size, duration: null, mime: msg.document.mime_type, name: msg.document.file_name ?? "audio" };
  if (msg.video_note) return { fileId: msg.video_note.file_id, fileSize: msg.video_note.file_size, duration: msg.video_note.duration, mime: "video/mp4", name: "note.mp4" };
  return null;
}
/** Bound both reported size and streamed bytes before passing audio to transcription. */
export async function downloadTelegramAudio(fileId: string, knownSize?: number): Promise<ArrayBuffer> {
  try {
    if (knownSize !== undefined && (!Number.isSafeInteger(knownSize) || knownSize <= 0 || knownSize > MAX_TELEGRAM_AUDIO_BYTES)) {
      throw new Error("telegram_invalid_media_size");
    }
    const file = await tg<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
    if (file.file_size !== undefined && (!Number.isSafeInteger(file.file_size) || file.file_size <= 0 || file.file_size > MAX_TELEGRAM_AUDIO_BYTES)) {
      throw new Error("telegram_invalid_media_size");
    }
    // getFile returns a relative path. Every validated component stays under the bot's file endpoint.
    const path = file.file_path;
    if (typeof path !== "string" || path.length > 300 ||
        !path.split("/").every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== "..")) {
      throw new Error("telegram_invalid_media_path");
    }
    const res = await fetch(`${TELEGRAM}/file/bot${botToken()}/${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error("telegram_http_error");
    const bytes = await boundedRequestBody(res, MAX_TELEGRAM_AUDIO_BYTES);
    if (!bytes.length) throw new Error("telegram_empty_media");
    return bytes.buffer;
  } catch {
    throw new Error("telegram_media_unavailable");
  }
}

export function appUrl(path = "/tg"): string {
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

export function botLink(startPayload: string): string {
  return `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${startPayload}`;
}

/** One message, one clear button that opens the Mini App. */
export function sendWithApp(chatId: number, text: string, buttonText: string, path: string) {
  return tg("sendMessage", {
    chat_id: chatId,
    text: telegramHtml(text),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [[{ text: buttonText, web_app: { url: appUrl(path) } }]] },
  });
}

export function send(chatId: number, text: string) {
  return tg("sendMessage", { chat_id: chatId, text: telegramHtml(text), parse_mode: "HTML", link_preview_options: { is_disabled: true } });
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Bot templates use bold; other markup from translations is displayed as plain text. */
export function telegramHtml(text: string) {
  const tokens = /<\/?b>|&(?:amp|lt|gt);/g;
  let depth = 0;
  let balanced = true;
  for (const [token] of text.matchAll(tokens)) {
    if (token === "<b>") depth++;
    else if (token === "</b>" && --depth < 0) balanced = false;
  }
  if (depth !== 0) balanced = false;
  let pos = 0;
  let result = "";
  for (const match of text.matchAll(tokens)) {
    result += escapeHtml(text.slice(pos, match.index));
    result += balanced || match[0].startsWith("&") ? match[0] : escapeHtml(match[0]);
    pos = match.index + match[0].length;
  }
  return result + escapeHtml(text.slice(pos));
}
