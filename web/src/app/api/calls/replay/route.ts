import { timingSafeEqual } from "node:crypto";
import { replayPending } from "@/lib/server/calls";

/**
 * Ops endpoint for the NudgeBee recovery runbook: after `result_processing_paused` is turned
 * off, apply every stored-but-unapplied call result exactly once. Safe to call repeatedly.
 */
export async function POST(req: Request) {
  const want = Buffer.from(process.env.OPS_SECRET ?? "");
  const got = Buffer.from(req.headers.get("x-ops-secret") ?? "");
  if (!want.length || want.length !== got.length || !timingSafeEqual(want, got)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return Response.json({ results: await replayPending() });
}
