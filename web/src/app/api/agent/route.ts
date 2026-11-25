import { after } from "next/server";
import { authed } from "@/lib/server/route";
import { db } from "@/lib/server/supabase";
import { runAgent } from "@/lib/server/agent";
import { HttpError, memberships } from "@/lib/server/weddings";

export const maxDuration = 60;

async function member(tgUserId: number, weddingId?: string) {
  const me = (await memberships(tgUserId)).find((m) => !weddingId || m.wedding_id === weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  return me;
}

/** The agent's activity feed: what it noticed and did, newest first. Message texts stay out of it. */
export const GET = authed(async (req, viewer) => {
  const me = await member(viewer.id, new URL(req.url).searchParams.get("wedding") ?? undefined);
  const { data } = await db()
    .from("agent_runs")
    .select("id, trigger, model, status, summary, started_at, finished_at, actions")
    .eq("wedding_id", me.wedding_id)
    .in("status", ["done", "running"])
    .order("started_at", { ascending: false })
    .limit(8);
  return {
    runs: (data ?? []).map((r) => ({
      id: r.id,
      trigger: r.trigger,
      model: r.model,
      status: r.status,
      summary: r.summary,
      at: r.started_at,
      messages: ((r.actions as { tool: string; audience?: string; result?: string }[]) ?? []).filter((a) => a.tool === "send_message" && String(a.result).startsWith("sent")).map((a) => a.audience),
    })),
  };
});

/** "Check now": wakes the agent for this wedding immediately (same rules as the heartbeat). */
export const POST = authed(async (req, viewer) => {
  const body = (await req.json().catch(() => ({}))) as { weddingId?: string };
  const me = await member(viewer.id, body.weddingId);
  after(() => runAgent(me.wedding_id, "manual").catch((e) => console.error("manual agent run failed", e)));
  return { ok: true };
});
