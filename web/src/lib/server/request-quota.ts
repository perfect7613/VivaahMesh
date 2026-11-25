import "server-only";
import { db } from "./supabase";

export async function takeRequestSlot(scope: string, operation: string, limit: number, seconds: number): Promise<boolean> {
  const { data, error } = await db().rpc("take_voice_request", {
    p_scope: scope,
    p_operation: operation,
    p_limit: limit,
    p_window_seconds: seconds,
  });
  if (error) throw new Error("request_quota_unavailable");
  return data === true;
}

/** Every interactive entry point uses the Telegram identity, independent of wedding or client. */
export async function takeAgentRequest(userId: number): Promise<boolean> {
  return takeRequestSlot(`tg:${userId}`, "planning-agent", 20, 24 * 60 * 60);
}
