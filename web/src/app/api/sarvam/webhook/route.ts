import { after } from "next/server";
import { dispatchStoredResult, storeCallResult, verifyCallToken } from "@/lib/server/calls";
import { voiceJsonObject } from "@/lib/server/voice-request";
import { HttpError } from "@/lib/server/weddings";

export const maxDuration = 60;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/** Persist the call result before applying it in the background. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const callId = url.searchParams.get("call") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!UUID.test(callId) || !/^[a-f0-9]{64}$/.test(token) || !verifyCallToken(callId, token)) {
    return Response.json({ error: "forbidden" }, { status: 403, headers });
  }
  try {
    const payload = await voiceJsonObject(req, 1024 * 1024);
    // Sarvam echoes the callback URL (including the bearer) and full phone details.
    delete payload.webhook_config;
    delete payload.channel_info;
    const { duplicate } = await storeCallResult(callId, payload);
    if (!duplicate) after(() => dispatchStoredResult(callId).catch(() => console.error("Saved phone result requires replay.")));
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers });
    console.error("Could not store phone call result.");
    return Response.json({ error: "store_failed" }, { status: 500, headers });
  }
  return Response.json({ ok: true }, { headers });
}
