/**
 * Contract for the deterministic wedding compiler (PRD → "Deterministic wedding compiler", issue #3).
 * compile() must be a PURE function: same snapshot + policy in → same result out. No I/O.
 * Flagsmith supplies `policy` (issue #4). Proposals never approve, book or dial anything.
 */

/** Minutes since midnight on the function's day. 20:30 → 1230. */
export type Minute = number;

export type HouseholdSide = "A" | "B";

export interface Activity {
  id: string;
  functionKind: string; // "sangeet" | "ceremony" | …
  title: string;
  kind: "dance" | "dinner" | "makeup" | "ritual" | "coverage" | "music" | "other";
  start: Minute;
  end: Minute;
  /** Fixed activities (e.g. dinner at 8:30 for grandparents) are never moved by proposals. */
  flexible: boolean;
  requiresAmplifiedMusic?: boolean;
  /** Who asked for it: shown as attribution, and used to rank proposals by family priority. */
  requestedBy?: { side: HouseholdSide; memberName: string; priority: "must" | "prefer" | "nice" };
  canOverlapWith?: Activity["kind"][];
}

export type FactKind = "music_cutoff" | "dinner_start" | "makeup_ready" | "coverage_end" | "overtime_rate";

export interface Fact {
  id: string;
  kind: FactKind;
  functionKind: string;
  /** Minute for time facts, rupees for rates. Null while unresolved. */
  value: number | null;
  status: "confirmed" | "conditional" | "unresolved";
  /** Vendor's own wording plus where it came from (call id, quote doc, typed reply). */
  source: { channel: "samvaad_call" | "browser_agent" | "quote" | "typed" | "seed"; ref: string; wording: string };
  supersedes?: string;
}

/** Remote config from Flagsmith `compiler_policy`. */
export interface CompilerPolicy {
  version: string;
  strategy: "preserve_family_priorities" | "minimize_changes" | "lowest_confirmed_cost";
  makeupBufferMin: number;
  setupBufferMin: number;
  maxProposals: number;
  allowDanceDuringDinner: boolean;
}

export const DEFAULT_POLICY: CompilerPolicy = {
  version: "default",
  strategy: "preserve_family_priorities",
  makeupBufferMin: 15,
  setupBufferMin: 10,
  maxProposals: 3,
  allowDanceDuringDinner: false,
};

export interface Snapshot {
  weddingId: string;
  revision: number;
  activities: Activity[];
  facts: Fact[];
}

export interface Conflict {
  activityId: string;
  constraint: FactKind | "overlap" | "buffer";
  /** Positive minutes over the limit, e.g. a dance ending 10:05 against a 10:00 cutoff → 5. */
  overByMin: number;
  explanation: string;
}

export interface Move {
  activityId: string;
  from: { start: Minute; end: Minute };
  to: { start: Minute; end: Minute };
}

export interface Proposal {
  id: string;
  moves: Move[];
  /** Null = "Price pending": never invent a cost. */
  costDeltaInr: number | null;
  satisfies: string[]; // human-readable family priorities preserved
  rank: number;
}

export interface ConditionalProposal extends Proposal {
  missing: { question: string; askWhom: string; factKind: FactKind };
}

export interface CompileResult {
  conflicts: Conflict[];
  proposals: Proposal[];
  conditional: ConditionalProposal[];
  /** When nothing fits: what blocks it and whose input could unblock it. */
  blocking: { constraint: string; whoCanResolve: string }[];
  policyVersion: string;
}

export type Compile = (snapshot: Snapshot, policy: CompilerPolicy) => CompileResult;
