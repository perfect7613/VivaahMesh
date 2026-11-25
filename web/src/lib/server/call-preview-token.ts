import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { callerPromptFor } from "./flags";
import { HttpError } from "./weddings";
import type { CallerPrompt } from "../experiment/metrics";

type Member = { id: string; wedding_id: string };
function signature(payload: string, member: Member, recipient: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new HttpError(503, "calling_not_configured");
  return createHmac("sha256", key).update(JSON.stringify(["caller-preview-v1", member.wedding_id, member.id, recipient, payload])).digest();
}

export async function newCallPreview(member: Member, recipient: string) {
  const id = randomUUID();
  const prompt = await callerPromptFor(id);
  const payload = Buffer.from(JSON.stringify({ id, prompt, expires: Date.now() + 10 * 60_000 })).toString("base64url");
  return { id, prompt, token: payload + "." + signature(payload, member, recipient).toString("base64url") };
}

export async function authorizedPrompt(token: unknown, member: Member, recipient: string) {
  // Older clients create their first call identity at authorization.
  if (token === undefined) return newCallPreview(member, recipient);
  const changed = () => new HttpError(409, "browser_preview_changed");
  if (typeof token !== "string" || token.length > 2048) throw changed();
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined) throw changed();
  const expected = signature(payload, member, recipient);
  const actual = Buffer.from(mac, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw changed();
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { id: string; prompt: CallerPrompt; expires: number };
  if (Date.now() >= data.expires) throw changed();
  return data;
}
