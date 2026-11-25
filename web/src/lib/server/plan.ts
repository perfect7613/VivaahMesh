import "server-only";
import { db } from "./supabase";
import { HttpError, logEvent, memberships } from "./weddings";
import { compile, withConfirmedTimes } from "@/lib/compiler/compile";
import { demoSangeet } from "@/lib/compiler/fixtures/demo-sangeet";
import { activityFromRow, activityToRow, liveFactIds, type ActivityRow, type FactInput } from "@/lib/plan-input";
import {
  DEFAULT_POLICY,
  type Activity,
  type CompileResult,
  type CompilerPolicy,
  type Fact,
  type FactKind,
  type Snapshot,
} from "@/lib/compiler/types";

/** The only I/O in the planning path: load inputs. compile() itself stays pure. */
export async function loadSnapshot(weddingId: string): Promise<Snapshot | null> {
  const s = db();
  const [a, f] = await Promise.all([
    s.from("activities").select("*").eq("wedding_id", weddingId).order("start_min"),
    s.from("facts").select("*").eq("wedding_id", weddingId).order("created_at"),
  ]);
  if (a.error) throw a.error;
  if (f.error) throw f.error;
  if (!a.data?.length) return null;

  const activities: Activity[] = (a.data as ActivityRow[]).map(activityFromRow);
  const facts: Fact[] = (f.data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    functionKind: r.function_kind,
    value: r.value,
    status: r.status,
    source: { channel: r.channel, ref: r.ref, wording: r.wording },
    supersedes: r.supersedes?.length ? (r.supersedes as string[]) : undefined,
  }));
  return { weddingId, revision: facts.length, activities, facts };
}

async function requireMember(tgUserId: number, weddingId?: string) {
  const me = (await memberships(tgUserId)).find((m) => !weddingId || m.wedding_id === weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  return me;
}

export interface PlanView {
  snapshotRevision: number;
  activities: Activity[];
  facts: { id: string; kind: FactKind; functionKind: string; value: number | null; status: Fact["status"]; wording: string; channel: string }[];
  result: CompileResult;
}

/** Recompiles from the current facts on every read, so a new fact is reflected immediately. */
export async function planView(tgUserId: number, weddingId?: string, policy: CompilerPolicy = DEFAULT_POLICY): Promise<PlanView | null> {
  const me = await requireMember(tgUserId, weddingId);
  const snap = await loadSnapshot(me.wedding_id);
  if (!snap) return null;
  return {
    snapshotRevision: snap.revision,
    // Same times the compiler used (e.g. dinner moved by a confirmed dinner_start fact).
    activities: withConfirmedTimes(snap).activities,
    facts: snap.facts.map((f) => ({ id: f.id, kind: f.kind, functionKind: f.functionKind, value: f.value, status: f.status, wording: f.source.wording, channel: f.source.channel })),
    result: compile(snap, policy),
  };
}

/**
 * Records a typed fact (e.g. Meera's reply). Input must already be validated by `parseFactInput`.
 * It supersedes EVERY live fact of the same kind and function, so a typed correction also clears
 * an earlier contradiction instead of leaving one of the conflicting answers in force.
 */
export async function addFact(tgUserId: number, input: FactInput) {
  const me = await requireMember(tgUserId, input.weddingId);
  const s = db();
  const { data: rows, error: readErr } = await s
    .from("facts")
    .select("id, supersedes")
    .eq("wedding_id", me.wedding_id)
    .eq("kind", input.kind)
    .eq("function_kind", input.functionKind)
    .order("created_at");
  // Never insert with a guessed supersession: a failed read must not leave a contradiction behind.
  if (readErr) throw readErr;

  const { error } = await s.from("facts").insert({
    wedding_id: me.wedding_id,
    kind: input.kind,
    function_kind: input.functionKind,
    value: input.value,
    status: input.status,
    channel: "typed",
    ref: me.id,
    wording: input.wording,
    supersedes: liveFactIds(rows ?? []),
    author_member_id: me.id,
  });
  if (error) throw error;
  await logEvent(me.wedding_id, me.id, "fact_added", { kind: input.kind, value: input.value, status: input.status });
  return me.wedding_id;
}

/** Couple-only: load the PRD's demo Sangeet into this wedding. Everything inserted is marked source='seed'. */
export async function seedDemoPlan(tgUserId: number, weddingId?: string) {
  const me = await requireMember(tgUserId, weddingId);
  if (!me.is_couple) throw new HttpError(403, "couple_only");
  // One transaction (see seed_demo_plan in the migration): either the activities AND facts are
  // inserted, or nothing is, so a failed seed can always be retried.
  const { data: seeded, error } = await db().rpc("seed_demo_plan", {
    p_wedding: me.wedding_id,
    p_activities: demoSangeet.activities.map(activityToRow),
    p_facts: demoSangeet.facts.map((f) => ({
      kind: f.kind,
      function_kind: f.functionKind,
      value: f.value,
      status: f.status,
      channel: f.source.channel,
      ref: f.source.ref,
      wording: f.source.wording,
    })),
  });
  if (error) throw error;
  if (!seeded) return me.wedding_id; // already had a plan
  await logEvent(me.wedding_id, me.id, "demo_plan_seeded", {});
  return me.wedding_id;
}
