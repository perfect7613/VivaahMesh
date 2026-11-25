import { authorizedOps } from "@/lib/server/ops-auth";
import { reportResultIncidents } from "@/lib/server/result-incidents";

/** NudgeBee's independent schedule can detect a stopped result worker. */
export async function POST(req: Request) {
  if (!authorizedOps(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.NUDGEBEE_EVENT_WEBHOOK_URL) return Response.json({ error: "incident_webhook_unconfigured" }, { status: 503 });
  return Response.json(await reportResultIncidents());
}
