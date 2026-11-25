import { createHmac, timingSafeEqual } from "node:crypto";

export const groupPattern = /^\d{5,24}(?:-\d{5,24})?@g\.us$/;
const maxAge = 15 * 60 * 1000;

export function validSignature(secret, body, signature) {
  if (typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

export function normalizeMessage(event, group, language, now = Date.now()) {
  if (!event || !groupPattern.test(group) || event.Chat !== group || event.FromMe !== false ||
      event.EventType || event.Edited || event.Revoked || event.ReactionToID || event.Call ||
      event.Poll || event.PollVote || event.PollAdd || event.Location ||
      typeof event.ID !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(event.ID)) return null;
  const sentAt = Date.parse(event.Timestamp);
  if (!Number.isFinite(sentAt) || sentAt < now - maxAge || sentAt > now + 60_000) return null;
  const author = typeof event.PushName === "string" ? event.PushName.trim().slice(0, 100) : "";
  const base = { group, messageId: event.ID, sentAt, author };
  const text = typeof event.Text === "string" ? event.Text.trim() : "";
  if (text.startsWith("/link")) {
    const match = !event.Media && /^\/link\s+([a-f0-9]{10}|[a-f0-9]{32})$/.exec(text);
    return match ? { ...base, action: "link", code: match[1], language } : null;
  }
  if (event.Media) {
    const { Type, MimeType, FileLength } = event.Media;
    return Type === "audio" && typeof MimeType === "string" && /^audio\/ogg(?:;|$)/i.test(MimeType) &&
      Number.isSafeInteger(FileLength) && FileLength > 0 && FileLength <= 1_048_576
      ? { ...base, action: "voice" } : null;
  }
  return text ? { ...base, action: "text", text: text.slice(0, 3000) } : null;
}
