import { authorizedOps } from "@/lib/server/ops-auth";
import { replayPending } from "@/lib/server/calls";
import { killSwitch } from "@/lib/server/flags";
import { setFlagEnabled } from "@/lib/server/flagsmith-admin";

import { boundedRequestBody } from "@/lib/server/request-body";
import { HttpError } from "@/lib/server/weddings";

export const maxDuration = 120;

/**
 * NudgeBee recovery runbook, one HTTP call after the human approval step:
 *  1. turn the Flagsmith kill switch `result_processing_paused` off
 *  2. wait until the app itself sees it off
 *  3. apply every stored-but-unapplied venue answer exactly once (each resolves its NudgeBee event)
 * It never dials anyone: outbound calls need a parent's tap in the app.
 * `{"dryRun": true}` only reports what would be replayed.
 */
export async function POST(req: Request) {
  if (!authorizedOps(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  let dryRun = false;
  try {
    const bytes = await boundedRequestBody(req, 1024);
    if (bytes.length) {
      const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).some((key) => key !== "dryRun") ||
          ("dryRun" in body && typeof body.dryRun !== "boolean")) {
        return Response.json({ error: "invalid_body" }, { status: 400 });
      }
      dryRun = "dryRun" in body && body.dryRun === true;
    }
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!dryRun && process.env.CALL_RESULT_PROCESSOR === "worker") {
    return Response.json({ error: "use_approved_worker_recovery" }, { status: 409 });
  }
  try {
    const paused = () => killSwitch("result_processing_paused", true);
    if (dryRun) return Response.json({ dryRun: true, paused: await paused() });
    let flag: Awaited<ReturnType<typeof setFlagEnabled>> | string = "already off";
    if (await paused()) {
      flag = await setFlagEnabled("result_processing_paused", false);
      for (let i = 0; i < 10 && await paused(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    if (await paused()) return Response.json({ error: "processing_still_paused" }, { status: 503 });
    return Response.json({ flag, stillPaused: false, replayed: await replayPending() });
  } catch {
    console.error("Approved inline recovery could not complete");
    return Response.json({ error: "recovery_unavailable" }, { status: 503 });
  }
}
