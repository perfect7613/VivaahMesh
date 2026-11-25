import { after } from "next/server";
import { jsonObject } from "@/lib/server/request-body";
import { takeAgentRequest } from "@/lib/server/request-quota";
import { authed } from "@/lib/server/route";
import { db } from "@/lib/server/supabase";
import { AGENT_CHECKED, SHARED_AGENT_TRIGGERS } from "@/lib/server/agent-scope";
import { runAgent } from "@/lib/server/agent";
import { HttpError, memberships } from "@/lib/server/weddings";
import { localized } from "@/lib/server/translate";
import { pickLang } from "@/lib/i18n";

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
    .select("id, trigger, model, status, started_at, actions")
    .eq("wedding_id", me.wedding_id)
    .in("status", ["done", "running"])
    .in("trigger", SHARED_AGENT_TRIGGERS)
    .order("started_at", { ascending: false })
    .limit(8);
  const { data: m } = await db().from("members").select("language").eq("id", me.id).single();
  const lang = pickLang(m?.language);
  const text = await localized(AGENT_CHECKED, lang);
  return {
    runs: (data ?? []).map((r) => ({
      id: r.id,
      trigger: r.trigger,
      model: r.model,
      status: r.status,
      text: r.status === "done" ? text : null,
      at: r.started_at,
      messages: ((Array.isArray(r.actions) ? r.actions : []) as { tool: string; result?: string }[]).filter((a) => a?.tool === "send_message" && typeof a.result === "string" && a.result.startsWith("sent")).length,
    })),
    // #11: what is being handled, and by whom (open owned tasks, escalations first).
    tasks: await openTasks(me.wedding_id),
  };
});

/** "Check now": wakes the agent for this wedding immediately (same rules as the heartbeat). */
export const POST = authed(async (req, viewer) => {
  const body = req.body ? await jsonObject(req, 8192) : {};
  if (body.weddingId !== undefined && typeof body.weddingId !== "string") throw new HttpError(400, "invalid_wedding");
  const me = await member(viewer.id, body.weddingId);
  if (!(await takeAgentRequest(viewer.id))) throw new HttpError(429, "agent_request_limit");
  after(() => runAgent(me.wedding_id, "manual").catch(() => console.error("manual agent run failed")));
  return { ok: true };
});

async function openTasks(weddingId: string) {
  const [{ data: ts }, { data: ms }] = await Promise.all([
    db().from("tasks").select("id, title, kind, owner_member_id, owner_label, due_date, escalated").eq("wedding_id", weddingId).neq("status", "done").order("escalated", { ascending: false }).order("created_at").limit(5),
    db().from("members").select("id, display_name").eq("wedding_id", weddingId),
  ]);
  return (ts ?? []).map((t) => ({ id: t.id, title: t.title, kind: t.kind, due: t.due_date, escalated: t.escalated, owner: (ms ?? []).find((m) => m.id === t.owner_member_id)?.display_name ?? t.owner_label ?? null }));
}
