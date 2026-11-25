import { processCallResult, replayPending } from "@/lib/server/calls";
import { authorizedOps } from "@/lib/server/ops-auth";

export const maxDuration = 300;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** Empty requests drain the queue. An incident replay applies exactly the selected stored answer. */
export async function POST(req: Request) {
  if (!authorizedOps(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const raw = await req.text();
  if (!raw.trim()) return Response.json({ results: await replayPending() });

  let callId: unknown;
  try { callId = JSON.parse(raw)?.callId; } catch { /* invalid JSON */ }
  if (typeof callId !== "string" || !UUID.test(callId)) return Response.json({ error: "invalid_call_id" }, { status: 400 });

  const outcome = await processCallResult(callId);
  const status = outcome === "paused" ? 409 : outcome === "no_result" ? 404 : 200;
  return Response.json({ results: { [callId]: outcome } }, { status });
}
