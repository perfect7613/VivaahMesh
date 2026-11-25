import "server-only";
import { db } from "./supabase";
import { HttpError, logEvent, memberships, pingWedding } from "./weddings";
import { familyRequirements } from "./family-voice";
import { applyFamilyRequirements } from "@/lib/family-plan";
import { makeupEnquiries } from "./makeup-enquiries";
import { compile, withConfirmedTimes } from "@/lib/compiler/compile";
import { demoSangeet } from "@/lib/compiler/fixtures/demo-sangeet";
import { flagsForMember, weddingFlags, type ResolvedFlags } from "./flags";
import { activityFromRow, activityToRow, typedFactRules, type ActivityRow, type FactInput } from "@/lib/plan-input";
import { areaOpen } from "@/lib/lifecycle";
import { applyProposal, buildRecap, policyForRevision, revisionFingerprint, ttlCache, type ApproveInput, type Recap, type RespondInput, type Stance } from "@/lib/revisions";
import type { Activity, CompileResult, CompilerPolicy, Fact, FactKind, Snapshot, VendorReplacement } from "@/lib/compiler/types";

/** The only I/O in the planning path: load inputs. compile() itself stays pure. */
export async function loadSnapshot(
  weddingId: string, enquiries = makeupEnquiries(weddingId), replacements = pendingVendorReplacements(weddingId),
): Promise<Snapshot | null> {
  const s = db();
  const [a, f, requirements, makeup, vendors] = await Promise.all([
    s.from("activities").select("*").eq("wedding_id", weddingId).order("start_min"),
    s.from("facts").select("*").eq("wedding_id", weddingId).order("created_at"),
    familyRequirements(weddingId),
    enquiries,
    replacements,
  ]);
  if (a.error) throw a.error;
  if (f.error) throw f.error;
  if (!a.data?.length && !vendors.length) {
    const history = await s.from("vendors").select("id").eq("wedding_id", weddingId)
      .not("replaces_vendor_id", "is", null).limit(1);
    if (history.error) throw history.error;
    if (!history.data?.length) return null;
  }

  const activities: Activity[] = ((a.data ?? []) as ActivityRow[]).map(activityFromRow);
  const facts: Fact[] = (f.data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    functionKind: r.function_kind,
    value: r.value,
    status: r.status,
    source: { channel: r.channel, ref: r.ref, wording: r.wording },
    supersedes: r.supersedes?.length ? (r.supersedes as string[]) : undefined,
  }));
  const revision = requirements.reduce((value, item) => value + item.version, facts.length);
  const withdrawnMakeupOptions = makeup.filter((enquiry) => enquiry.status === "withdrawn")
    .map(({ functionKind, proposalId, readyBy }) => ({ functionKind, proposalId, readyBy }));
  return applyFamilyRequirements({ weddingId, revision, activities, facts, withdrawnMakeupOptions, vendorReplacements: vendors.map(({ quote, ...vendor }) => vendor) }, requirements);
}

async function pendingVendorReplacements(weddingId: string): Promise<(VendorReplacement & { quote: number | null })[]> {
  const { data, error } = await db().from("pending_vendor_replacements")
    .select("id, name, functions, seeded, quote_inr, cancelled_vendor_id, cancelled_vendor_name")
    .eq("wedding_id", weddingId).order("id");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    vendorId: row.id, vendorName: row.name, cancelledVendorId: row.cancelled_vendor_id,
    cancelledVendorName: row.cancelled_vendor_name, functions: row.functions, seeded: row.seeded, quote: row.quote_inr,
  }));
}

async function requireMember(tgUserId: number, weddingId?: string) {
  const me = (await memberships(tgUserId)).find((m) => !weddingId || m.wedding_id === weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  return me;
}

/** What is stored with every revision and approval: which Flagsmith configuration produced it. */
function flagSnapshot(f: ResolvedFlags) {
  return { source: f.source, policy: f.policy, features: f.features };
}

/** Wedding flags are cached briefly: every phone polls every few seconds and Flagsmith need not be asked each time. */
const flagCache = ttlCache<ResolvedFlags>(5000);
async function cachedWeddingFlags(weddingId: string, stage: string): Promise<ResolvedFlags> {
  const hit = flagCache.get(weddingId);
  if (hit) return hit;
  const flags = await weddingFlags(weddingId, stage);
  // Never cache the outage fallback: recover the moment Flagsmith is back.
  if (flags.source === "flagsmith") flagCache.set(weddingId, flags);
  return flags;
}

/**
 * Compiles the current plan with the WEDDING-level policy (so both households get the same
 * ranking) and records it as a revision. A new revision number appears only when the plan state
 * changed; see revisionFingerprint and record_revision.
 */
async function currentRevision(weddingId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await tryCurrentRevision(weddingId);
    if (current !== undefined) return current;
  }
  throw new HttpError(503, "plan_revision_busy");
}

async function tryCurrentRevision(weddingId: string) {
  const s = db();
  const latest = await s.from("plan_revisions").select("revision, fingerprint, result, flags")
    .eq("wedding_id", weddingId).order("revision", { ascending: false }).limit(1);
  if (latest.error) throw latest.error;
  const last = latest.data?.[0];

  const makeup = makeupEnquiries(weddingId);
  const pending = pendingVendorReplacements(weddingId);
  const [snap, enquiries, w, replacements] = await Promise.all([
    loadSnapshot(weddingId, makeup, pending),
    makeup,
    s.from("weddings").select("stage").eq("id", weddingId).single(),
    pending,
  ]);
  if (w.error) throw w.error;
  if (!snap) return null;

  const resolved = await cachedWeddingFlags(weddingId, w.data.stage);
  // During a Flagsmith outage keep the policy the latest revision was made with (see policyForRevision).
  const storedPolicy = (last?.flags as { policy?: CompilerPolicy } | undefined)?.policy ?? null;
  const policy = policyForRevision(resolved, storedPolicy);
  const flags: ResolvedFlags = { ...resolved, policy };
  const fingerprint = revisionFingerprint(snap, policy);

  // Fast path for the common poll: nothing changed, so no write and no row lock.
  if (last && last.fingerprint === fingerprint) {
    return { snap, enquiries, flags, replacements, result: last.result as CompileResult, revision: last.revision as number };
  }

  const result = compile(snap, policy);
  const { data: revision, error } = await s.rpc("record_revision_if_current", {
    p_wedding: weddingId,
    p_expected_revision: last?.revision ?? 0,
    p_fingerprint: fingerprint,
    p_result: result,
    p_flags: flagSnapshot(flags),
  });
  if (error) throw error;
  if (revision === null) return undefined;
  // Return what was STORED for this revision (a concurrent request may have recorded it first),
  // because responses and approvals are validated against the stored result.
  const { data: stored, error: sErr } = await s.from("plan_revisions").select("result").eq("wedding_id", weddingId).eq("revision", revision as number).single();
  if (sErr) throw sErr;
  return { snap, enquiries, flags, replacements, result: stored.result as CompileResult, revision: revision as number };
}

export interface HouseholdResponse {
  householdId: string;
  side: "A" | "B";
  family: string;
  memberName: string;
  proposalId: string;
  stance: Stance;
  note: string;
  updatedAt: string;
}

export interface PlanView {
  revision: number;
  activities: Activity[];
  facts: { id: string; kind: FactKind; functionKind: string; value: number | null; status: Fact["status"]; wording: string; channel: string }[];
  makeupEnquiries: Awaited<ReturnType<typeof makeupEnquiries>>;
  result: CompileResult;
  policy: { version: string; strategy: CompilerPolicy["strategy"]; source: ResolvedFlags["source"] };
  /** Both households' responses to THIS revision. */
  responses: HouseholdResponse[];
  /** The latest couple approval: what the committed timeline came from. Survives refresh. */
  committed: { revision: number; proposalId: string; approvedBy: string; approvedAt: string; recap: Recap } | null;
  canRespond: boolean;
  canApprove: boolean;
  replacementQuotes?: Record<string, number | null>;
}

/** Recompiles from the current facts on every read, so a new fact is reflected immediately. */
export async function planView(tgUserId: number, weddingId?: string): Promise<PlanView | null> {
  const me = await requireMember(tgUserId, weddingId);
  const cur = await currentRevision(me.wedding_id);
  if (!cur) return null;
  const timed = withConfirmedTimes(cur.snap).activities;
  const s = db();
  const [rev, hs, ms, ap] = await Promise.all([
    s.from("plan_revisions").select("id").eq("wedding_id", me.wedding_id).eq("revision", cur.revision).single(),
    s.from("households").select("id, side, name").eq("wedding_id", me.wedding_id),
    s.from("members").select("id, display_name").eq("wedding_id", me.wedding_id),
    // Only revision-bound approvals (revision_id set); rows from the earlier flow have no recap.
    s.from("approvals").select("snapshot_revision, proposal_id, approved_by, created_at, recap").eq("wedding_id", me.wedding_id).not("revision_id", "is", null).order("created_at", { ascending: false }).limit(1),
  ]);
  for (const r of [rev, hs, ms, ap]) if (r.error) throw r.error;
  const { data: rs, error: rErr } = await s
    .from("household_responses")
    .select("household_id, member_id, proposal_id, stance, note, updated_at")
    .eq("revision_id", rev.data!.id);
  if (rErr) throw rErr;

  const nameOf = (id: string | null) => (ms.data ?? []).find((m) => m.id === id)?.display_name ?? "";
  const responses: HouseholdResponse[] = (rs ?? [])
    .map((r) => {
      const h = (hs.data ?? []).find((x) => x.id === r.household_id);
      return {
        householdId: r.household_id,
        side: (h?.side ?? "A") as "A" | "B",
        family: h?.name ?? "",
        memberName: nameOf(r.member_id),
        proposalId: r.proposal_id,
        stance: r.stance as Stance,
        note: r.note,
        updatedAt: r.updated_at,
      };
    })
    .sort((x, y) => (x.side < y.side ? -1 : 1));
  const last = ap.data?.[0];

  return {
    revision: cur.revision,
    // Same times the compiler used (e.g. dinner moved by a confirmed dinner_start fact).
    activities: timed,
    facts: cur.snap.facts.map((f) => ({ id: f.id, kind: f.kind, functionKind: f.functionKind, value: f.value, status: f.status, wording: f.source.wording, channel: f.source.channel })),
    makeupEnquiries: cur.enquiries,
    result: cur.result,
    policy: { version: cur.flags.policy.version, strategy: cur.flags.policy.strategy, source: cur.flags.source },
    responses,
    committed: last
      ? { revision: last.snapshot_revision, proposalId: last.proposal_id, approvedBy: nameOf(last.approved_by), approvedAt: last.created_at, recap: last.recap as Recap }
      : null,
    canRespond: !!me.household_id,
    canApprove: !!me.is_couple,
    ...(me.is_couple && cur.replacements.length ? { replacementQuotes: Object.fromEntries(cur.replacements.map((v) => [v.vendorId, v.quote])) } : {}),
  };
}

export type Outcome = { status: "ok"; weddingId: string } | { status: "stale"; weddingId: string };

/** One household's response to the current revision. Two households answering at once both stick. */
export async function respondToRevision(tgUserId: number, input: RespondInput): Promise<Outcome> {
  const me = await requireMember(tgUserId, input.weddingId);
  if (!me.household_id) throw new HttpError(403, "no_household");
  // Make sure the latest plan state is recorded, so answering an outdated revision is caught.
  await currentRevision(me.wedding_id);
  const { data, error } = await db().rpc("respond_to_revision", {
    p_wedding: me.wedding_id,
    p_revision: input.revision,
    p_member: me.id,
    p_proposal: input.proposalId,
    p_stance: input.stance,
    p_note: input.note,
  });
  if (error) throw error;
  const status = (data as { status: string }).status;
  if (status === "stale") return { status: "stale", weddingId: me.wedding_id };
  if (status === "no_household") throw new HttpError(403, "no_household");
  if (status === "bad_proposal") throw new HttpError(400, "bad_proposal");
  await logEvent(me.wedding_id, me.id, "proposal_response", { revision: input.revision, proposal: input.proposalId, stance: input.stance });
  return { status: "ok", weddingId: me.wedding_id };
}

/**
 * Couple approval of one proposal in one exact revision. If the plan has moved on (for example a
 * late vendor reply created a newer revision), nothing changes and the caller gets "stale".
 */
export async function approveRevision(tgUserId: number, input: ApproveInput): Promise<Outcome> {
  const me = await requireMember(tgUserId, input.weddingId);
  if (!me.is_couple) throw new HttpError(403, "couple_only");
  // Record the latest plan state first: new evidence since the couple looked means a new revision.
  const cur = await currentRevision(me.wedding_id);
  if (!cur) throw new HttpError(404, "no_plan");
  if (cur.revision !== input.revision) return { status: "stale", weddingId: me.wedding_id };

  const proposal = cur.result.proposals.find((p) => p.id === input.proposalId);
  if (!proposal) throw new HttpError(400, "bad_proposal");
  if (proposal.vendorReplacement) {
    const [{ data, error }, flags] = await Promise.all([
      db().from("weddings").select("stage").eq("id", me.wedding_id).single(),
      flagsForMember(me),
    ]);
    if (error) throw error;
    if (!areaOpen("day_of", data.stage, { source: flags.source, on: { stage_day_of: flags.features.stage_day_of?.enabled ?? false } })) {
      throw new HttpError(409, "stage_locked:day_of");
    }
  }
  const timed = withConfirmedTimes(cur.snap).activities;
  const functionKind = timed.find((activity) => activity.id === proposal.moves[0]?.activityId)?.functionKind;
  const approvedActivities = applyProposal(timed, proposal).filter((activity) => activity.functionKind === functionKind);
  const recap = buildRecap(input.revision, proposal, timed);

  const { data, error } = await db().rpc("approve_revision_with_activities", {
    p_wedding: me.wedding_id,
    p_revision: input.revision,
    p_member: me.id,
    p_proposal: input.proposalId,
    p_flags: flagSnapshot(cur.flags),
    p_recap: recap,
    p_activities: approvedActivities,
  });
  if (error) throw error;
  const status = (data as { status: string }).status;
  if (status === "stale") return { status: "stale", weddingId: me.wedding_id };
  if (status === "not_couple") throw new HttpError(403, "couple_only");
  if (status === "bad_proposal") throw new HttpError(400, "bad_proposal");
  if (status === "already_approved") throw new HttpError(409, "already_approved");
  await logEvent(me.wedding_id, me.id, "revision_approved", { revision: input.revision, proposal: input.proposalId });
  await pingWedding(me.wedding_id);
  return { status: "ok", weddingId: me.wedding_id };
}

/**
 * Records a typed fact (e.g. Meera's reply). Input must already be validated by `parseFactInput`.
 * The insert and the supersession of every fact still in force happen in one locked database
 * function (add_fact), so simultaneous facts cannot contradict each other.
 */
export async function addFact(tgUserId: number, input: FactInput) {
  const me = await requireMember(tgUserId, input.weddingId);
  // Vendor terms are never confirmed by hand and never replace a call or a quote (see typedFactRules).
  const { status, replaceOnlyTyped } = typedFactRules(input.kind, input.status);
  const s = db();
  // The function must exist in this wedding's plan: no facts for a function that has no activities.
  const { count, error: cErr } = await s
    .from("activities").select("id", { count: "exact", head: true }).eq("wedding_id", me.wedding_id).eq("function_kind", input.functionKind);
  if (cErr) throw cErr;
  if (!count) throw new HttpError(400, "unknown_function");

  const { error } = await s.rpc("add_fact", {
    p_wedding: me.wedding_id,
    p_member: me.id,
    p_kind: input.kind,
    p_function: input.functionKind,
    p_value: input.value,
    p_status: status,
    p_wording: input.wording,
    p_replace_only_typed: replaceOnlyTyped,
  });
  if (error) throw error;
  await logEvent(me.wedding_id, me.id, "fact_added", { kind: input.kind, value: input.value, status });
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
