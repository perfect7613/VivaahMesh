/**
 * Pure helpers for revision-bound approval (issue #5). No I/O and no `server-only`, so they can be
 * unit-tested. The atomic parts (recording a revision, responses, approval) live in SQL functions;
 * see supabase/migrations/20261125150000_revision_approvals.sql.
 */
import type { Activity, CompilerPolicy, Fact, Minute, Proposal, Reason, Snapshot } from "@/lib/compiler/types";

// ---------------------------------------------------------------- fingerprint

/** JSON with object keys sorted at every level, so equal values always serialize identically. */
export function stableStringify(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

/** cyrb53: a small, fast, well-distributed 53-bit string hash. Enough to tell plan states apart. */
function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Facts still in force, reduced to what can change a plan (ids and wording are left out). */
function liveFactValues(facts: Fact[]) {
  const superseded = new Set(facts.flatMap((f) => (f.supersedes === undefined ? [] : ([] as string[]).concat(f.supersedes))));
  return facts
    .filter((f) => !superseded.has(f.id))
    .map((f) => ({ kind: f.kind, functionKind: f.functionKind, value: f.value, status: f.status }))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
}

/**
 * Identifies a plan state. A new revision is recorded only when this changes: new evidence, a moved
 * activity or a different compiler policy. Re-reading the same plan, or a vendor repeating an answer
 * already on file, does not create a revision.
 */
export function revisionFingerprint(snapshot: Snapshot, policy: CompilerPolicy, compilerVersion: number = COMPILER_VERSION): string {
  const activities = [...snapshot.activities].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const withdrawnMakeupOptions = snapshot.withdrawnMakeupOptions?.map(stableStringify).sort();
  return hash53(stableStringify({
    activities, facts: liveFactValues(snapshot.facts), policy, compilerVersion,
    ...(withdrawnMakeupOptions?.length ? { withdrawnMakeupOptions } : {}),
  }));
}

/**
 * Bump when a change to compile() can alter proposals for the same inputs (ranking, candidate
 * generation, ids). Stored revisions and their proposal ids then stop matching fresh compiles, so
 * a new revision is recorded instead of approving moves the family never saw.
 */
export const COMPILER_VERSION = 1;

/**
 * Which policy to compile a revision with. While Flagsmith is unreachable the resolved policy is
 * only the committed safe default; using it would change the fingerprint and mint a revision (and
 * another when Flagsmith recovers), hiding responses and turning pending approvals stale. So during
 * an outage we keep the policy the latest revision was made with.
 */
export function policyForRevision(resolved: { source: "flagsmith" | "safe_defaults"; policy: CompilerPolicy }, latestStored: CompilerPolicy | null): CompilerPolicy {
  return resolved.source === "safe_defaults" && latestStored ? latestStored : resolved.policy;
}

/** A tiny time-boxed cache with an injectable clock, used so polling does not hit Flagsmith every time. */
export function ttlCache<V>(ttlMs: number, now: () => number = Date.now) {
  const m = new Map<string, { at: number; v: V }>();
  return {
    get(key: string): V | undefined {
      const e = m.get(key);
      if (!e) return undefined;
      if (now() - e.at >= ttlMs) {
        m.delete(key);
        return undefined;
      }
      return e.v;
    },
    set(key: string, v: V) {
      m.set(key, { at: now(), v });
    },
  };
}

// ---------------------------------------------------------------- recap

export interface Recap {
  revision: number;
  proposalId: string;
  moves: { activityId: string; title: string; from: { start: Minute; end: Minute }; to: { start: Minute; end: Minute } }[];
  costDeltaInr: number | null;
  reasons: Reason[];
}

/** What the couple approved, as structured data: each phone phrases it in its own language. */
export function buildRecap(revision: number, proposal: Proposal, activities: Activity[]): Recap {
  return {
    revision,
    proposalId: proposal.id,
    moves: proposal.moves.map((m) => ({
      activityId: m.activityId,
      title: activities.find((a) => a.id === m.activityId)?.title ?? m.activityId,
      from: m.from,
      to: m.to,
    })),
    costDeltaInr: proposal.costDeltaInr,
    reasons: proposal.reasons,
  };
}

/** The committed timeline after an approval. Returns a copy; the input is never mutated. */
export function applyProposal(activities: Activity[], proposal: Proposal): Activity[] {
  const byId = new Map(proposal.moves.map((m) => [m.activityId, m]));
  return activities.map((a) => {
    const m = byId.get(a.id);
    return m ? { ...a, start: m.to.start, end: m.to.end } : a;
  });
}

// ---------------------------------------------------------------- request validation

export const STANCES = ["agree", "prefer_other", "object"] as const;
export type Stance = (typeof STANCES)[number];

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function common(body: unknown): Parsed<{ weddingId?: string; revision: number; proposalId: string; b: Record<string, unknown> }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "bad_body" };
  const b = body as Record<string, unknown>;
  if (b.weddingId !== undefined && typeof b.weddingId !== "string") return { ok: false, error: "bad_wedding" };
  if (typeof b.revision !== "number" || !Number.isInteger(b.revision) || b.revision < 1) return { ok: false, error: "bad_revision" };
  if (typeof b.proposalId !== "string" || !b.proposalId.trim() || b.proposalId.length > 120) return { ok: false, error: "bad_proposal" };
  return { ok: true, value: { weddingId: b.weddingId as string | undefined, revision: b.revision, proposalId: b.proposalId, b } };
}

export interface RespondInput {
  weddingId?: string;
  revision: number;
  proposalId: string;
  stance: Stance;
  note: string;
}

export function parseRespondInput(body: unknown): Parsed<RespondInput> {
  const c = common(body);
  if (!c.ok) return c;
  const { b, ...rest } = c.value;
  if (typeof b.stance !== "string" || !STANCES.includes(b.stance as Stance)) return { ok: false, error: "bad_stance" };
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : "";
  return { ok: true, value: { ...rest, stance: b.stance as Stance, note } };
}

export interface ApproveInput {
  weddingId?: string;
  revision: number;
  proposalId: string;
}

export function parseApproveInput(body: unknown): Parsed<ApproveInput> {
  const c = common(body);
  if (!c.ok) return c;
  const { weddingId, revision, proposalId } = c.value;
  return { ok: true, value: { weddingId, revision, proposalId } };
}
