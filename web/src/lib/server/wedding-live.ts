import "server-only";

import { createHmac } from "node:crypto";
import { WEDDING_TOPIC_PREFIX } from "../wedding-topic";

export function weddingTopic(weddingId: string): string | null {
  const key = process.env.WEDDING_REALTIME_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.length < 32) return null;
  const signature = createHmac("sha256", key).update("vivaahmesh:realtime:wedding:v1:").update(weddingId).digest("base64url");
  return `${WEDDING_TOPIC_PREFIX}${signature}`;
}

/** Best-effort invalidation. Subscribers must still authorize and fetch their own view. */
export async function pingWedding(weddingId: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const topic = weddingTopic(weddingId);
  if (!url || !key || !topic) return;
  try {
    await fetch(new URL("/realtime/v1/api/broadcast", url), {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ topic, event: "changed", payload: {} }] }),
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Polling covers temporary Realtime outages.
  }
}
