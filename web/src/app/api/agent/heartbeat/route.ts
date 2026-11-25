import { timingSafeEqual } from "node:crypto";
import { heartbeat } from "@/lib/server/agent";

export const maxDuration = 300;

/**
 * The agent's heartbeat. Called every few minutes by the scheduler (GitHub Actions, see
 * .github/workflows/heartbeat.yml) with x-ops-secret, or by Vercel Cron with CRON_SECRET.
 * Weddings with nothing new are skipped without a model call.
 */
async function handle(req: Request) {
  const ok = (secret: string | undefined, got: string | null) => {
    const a = Buffer.from(secret ?? "");
    const b = Buffer.from(got ?? "");
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  };
  const authorized =
    ok(process.env.OPS_SECRET, req.headers.get("x-ops-secret")) ||
    ok(process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : undefined, req.headers.get("authorization"));
  if (!authorized) return Response.json({ error: "forbidden" }, { status: 403 });
  const started = Date.now();
  try {
    const results = await heartbeat();
    return Response.json({ ms: Date.now() - started, results });
  } catch {
    console.error("Agent heartbeat failed");
    return Response.json({ error: "heartbeat_unavailable" }, { status: 503 });
  }
}

export const GET = handle;
export const POST = handle;
