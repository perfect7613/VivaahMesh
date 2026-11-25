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
  source: { channel: "samvaad_call" | "browser_agent" | "quote" | "typed" | "seed" | "dictate"; ref: string; wording: string };
  /** Earlier fact id(s) this one replaces, e.g. a mid-call correction or a typed fix of a contradiction. */
  supersedes?: string | string[];
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

export interface MakeupOption {
  functionKind: string;
  proposalId: string;
  readyBy: Minute;
}

export interface Snapshot {
  weddingId: string;
  revision: number;
  activities: Activity[];
  facts: Fact[];
  withdrawnMakeupOptions?: MakeupOption[];
}

export interface Conflict {
  activityId: string;
  /** `coverage_start`: a performance starts before video coverage begins. */
  constraint: FactKind | "overlap" | "buffer" | "coverage_start";
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
  satisfies: string[]; // human-readable (English) family priorities preserved, for logs
  /** The same priorities as structured data, so each phone can phrase them in its own language. */
  reasons: Reason[];
  rank: number;
}

export interface Requester {
  memberName: string;
  side: HouseholdSide;
  priority: "must" | "prefer" | "nice";
}

export type Reason =
  | { code: "dinner_kept"; at: Minute; noDanceDuring: boolean; by?: Requester }
  | { code: "duration_kept"; activityId: string; minutes: number; by?: Requester }
  | { code: "video_covered" };

/** Who can unblock something, as data: phones translate the role. */
export interface Resolver {
  role: "venue_owner" | "videographer" | "makeup_artist" | "household" | "planner";
  name?: string;
  side?: HouseholdSide;
}

export type BlockingItem = {
  /** Which function (sangeet, reception, …) this is about, so the same blocker in two functions stays two items. */
  functionKind: string;
  /** English description, for logs. */
  constraint: string;
  /** English resolver, for logs. */
  whoCanResolve: string;
  resolver: Resolver;
} & (
  | { code: "cutoff_unconfirmed" }
  | { code: "contradiction"; factKind: FactKind; values: number[] }
  | { code: "no_slot"; activityId: string; violated: Conflict["constraint"] }
  | { code: "fixed_conflict"; activityId: string; violated: Conflict["constraint"]; overByMin: number }
);

export interface ConditionalProposal extends Proposal {
  missing: { question: string; askWhom: string; factKind: FactKind; /** For time facts: the time the answer must meet, so UIs can localize the question. */ byMinute?: Minute };
}

export interface CompileResult {
  conflicts: Conflict[];
  proposals: Proposal[];
  conditional: ConditionalProposal[];
  /** When nothing fits: what blocks it and whose input could unblock it. */
  blocking: BlockingItem[];
  policyVersion: string;
}

export type Compile = (snapshot: Snapshot, policy: CompilerPolicy) => CompileResult;
