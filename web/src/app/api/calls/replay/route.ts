import { processCallResult, replayPending } from "@/lib/server/calls";
import { authorizedOps } from "@/lib/server/ops-auth";
import { boundedVoiceBody } from "@/lib/server/voice-request";
import { HttpError } from "@/lib/server/weddings";

export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** Empty requests drain the queue. An incident replay applies exactly the selected stored answer. */
export async function POST(req: Request) {
  if (!authorizedOps(req)) return Response.json({ error: "forbidden" }, { status: 403, headers });
  let raw: string;
  try {
    raw = new TextDecoder().decode(await boundedVoiceBody(req, 4096));
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "invalid_request" }, { status: 400, headers });
  }
  if (!raw.trim()) return Response.json({ results: await replayPending() }, { headers });

  let callId: unknown;
  try { callId = JSON.parse(raw)?.callId; } catch { /* invalid JSON */ }
  if (typeof callId !== "string" || !UUID.test(callId)) return Response.json({ error: "invalid_call_id" }, { status: 400, headers });

  const outcome = await processCallResult(callId);
  const status = outcome === "paused" ? 409 : outcome === "no_result" ? 404 : 200;
  return Response.json({ results: { [callId]: outcome } }, { status, headers });
}
