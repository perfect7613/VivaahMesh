import { after } from "next/server";
import { dispatchStoredResult, storeCallResult, verifyCallToken } from "@/lib/server/calls";

/**
 * Sarvam posts here after every attempt. The per-call token is an HMAC of the call id, so a
 * forged or replayed request for another call is rejected. The result is stored first and
 * processed after the response, so Sarvam never waits on (or retries because of) our compile.
 */
export const maxDuration = 60;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const callId = url.searchParams.get("call") ?? "";
  if (!callId || !verifyCallToken(callId, url.searchParams.get("token") ?? "")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const payload = await req.json().catch(() => null);
  if (!payload) return Response.json({ error: "bad_json" }, { status: 400 });
  try {
    await storeCallResult(callId, payload);
  } catch (e) {
    console.error("store call result", e);
    return Response.json({ error: "store_failed" }, { status: 500 });
  }
  after(async () => {
    try {
      console.log("call result", callId, await dispatchStoredResult(callId));
    } catch (e) {
      console.error("process call result", e);
    }
  });
  return Response.json({ ok: true });
}
