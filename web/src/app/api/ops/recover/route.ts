import { timingSafeEqual } from "node:crypto";
import { replayPending } from "@/lib/server/calls";
import { killSwitch } from "@/lib/server/flags";
import { setFlagEnabled } from "@/lib/server/flagsmith-admin";

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
  const want = Buffer.from(process.env.OPS_SECRET ?? "");
  const got = Buffer.from(req.headers.get("x-ops-secret") ?? "");
  if (!want.length || want.length !== got.length || !timingSafeEqual(want, got)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
  const steps: Record<string, unknown> = {};
  if (body.dryRun) return Response.json({ dryRun: true, paused: await killSwitch("result_processing_paused") });

  if (await killSwitch("result_processing_paused")) {
    steps.flag = await setFlagEnabled("result_processing_paused", false);
    for (let i = 0; i < 10 && (await killSwitch("result_processing_paused")); i++) await new Promise((r) => setTimeout(r, 1500));
  } else steps.flag = "already off";
  steps.stillPaused = await killSwitch("result_processing_paused");
  steps.replayed = steps.stillPaused ? {} : await replayPending();
  return Response.json(steps);
}
