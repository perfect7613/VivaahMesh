/**
 * Deterministic wedding compiler (issue #3).
 *
 * PURE: no I/O, no clock, no randomness, and the input is never mutated. The same
 * (snapshot, policy) always yields a deep-equal result. Proposals are plain data: this
 * module imports nothing that could approve, book, pay or dial.
 *
 * Modelling choices (see also the tests):
 *  - Intervals are half-open [start, end): back-to-back activities do not overlap, and an
 *    activity ending exactly at the music cutoff or coverage end fits.
 *  - Only flexible activities move. A proposal keeps the activity's duration.
 *  - Candidate start times are enumerated on a 5-minute grid.
 *  - Only CONFIRMED facts are hard inputs. Conditional/unresolved facts never constrain a
 *    proposal; they surface as "missing" (conditional options or `blocking`).
 *  - Overtime rate is read as ₹ per hour, pro-rated by the minutes of extension.
 */
import type {
  Activity,
  BlockingItem,
  Compile,
  CompileResult,
  CompilerPolicy,
  ConditionalProposal,
  Conflict,
  Fact,
  FactKind,
  Minute,
  Move,
  Proposal,
  Reason,
  Requester,
  Resolver,
  Snapshot,
} from "./types";

const GRID_MIN = 5;
const DAY_MIN = 24 * 60;
const PRIORITY_WEIGHT = { must: 3, prefer: 2, nice: 1 } as const;
/** Kinds of activity that are "performances": bound by sound cutoff and video coverage. */
const PERFORMANCE_KINDS: Activity["kind"][] = ["dance", "music"];

// ---------------------------------------------------------------- formatting

export function fmtMinute(m: Minute): string {
  const h24 = Math.floor(m / 60) % 24;
  const mm = String(m % 60).padStart(2, "0");
  const suffix = h24 >= 12 ? "pm" : "am";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${suffix}`;
}

// ---------------------------------------------------------------- fact resolution

interface ResolvedFact {
  /** Confirmed value, or null when unknown / contradictory. */
  value: number | null;
  fact?: Fact;
  contradiction?: Fact[];
}

function resolveFact(facts: Fact[], kind: FactKind, functionKind: string): ResolvedFact {
  const scoped = facts.filter((f) => f.kind === kind && f.functionKind === functionKind);
  const superseded = new Set(scoped.flatMap((f) => (f.supersedes === undefined ? [] : ([] as string[]).concat(f.supersedes))));
  const live = scoped.filter((f) => !superseded.has(f.id));
  const confirmed = live.filter((f) => f.status === "confirmed" && f.value !== null);
  const distinct = new Set(confirmed.map((f) => f.value));
  if (distinct.size > 1) return { value: null, contradiction: confirmed };
  if (confirmed.length > 0) return { value: confirmed[0].value, fact: confirmed[0] };
  return { value: null, fact: live[0] };
}

// ---------------------------------------------------------------- evaluation of one placement

type Constraint = Conflict["constraint"];

interface Violation {
  constraint: Constraint;
  overByMin: number;
  explanation: string;
  /** Who can unblock this constraint (English, for logs) … */
  resolverText: string;
  /** … and as data for translated UIs. */
  resolver: Resolver;
}

interface Missing {
  question: string;
  askWhom: string;
  factKind: FactKind;
  byMinute?: Minute;
}

interface Evaluation {
  violations: Violation[];
  /** Set when the placement is only feasible if this fact gets confirmed. */
  missing?: Missing;
}

interface Context {
  snapshot: Snapshot;
  policy: CompilerPolicy;
  /** per functionKind */
  cutoff: Map<string, number | null>;
  coverageEnd: Map<string, number | null>;
  makeupReady: Map<string, number | null>;
}

const overlapMin = (aS: number, aE: number, bS: number, bE: number) =>
  Math.max(0, Math.min(aE, bE) - Math.max(aS, bS));

function who(a: Activity | undefined): string {
  return a?.requestedBy ? `Household ${a.requestedBy.side} (${a.requestedBy.memberName})` : "the planner";
}

function whoResolver(a: Activity | undefined): Resolver {
  return a?.requestedBy ? { role: "household", side: a.requestedBy.side, name: a.requestedBy.memberName } : { role: "planner" };
}

const requester = (a: Activity | undefined): Requester | undefined =>
  a?.requestedBy ? { memberName: a.requestedBy.memberName, side: a.requestedBy.side, priority: a.requestedBy.priority } : undefined;

/** Coverage end used everywhere: the confirmed fact wins over the coverage activity's planned end. */
function coverageEndFor(ctx: Context, functionKind: string): number | null {
  const act = ctx.snapshot.activities.find((o) => o.kind === "coverage" && o.functionKind === functionKind);
  return ctx.coverageEnd.get(functionKind) ?? act?.end ?? null;
}

function makeupArtist(makeup: Activity): string {
  return /\(([^)]+)\)/.exec(makeup.title)?.[1] ?? "the makeup artist";
}

/**
 * `report`: listing conflicts of the plan as it stands, so each clashing pair is reported once.
 * `place`: scoring a candidate slot for `a`, so every other activity is checked.
 */
type Mode = "report" | "place";

function evaluate(ctx: Context, a: Activity, start: Minute, end: Minute, mode: Mode): Evaluation {
  const { snapshot, policy } = ctx;
  const violations: Violation[] = [];
  const isPerformance = PERFORMANCE_KINDS.includes(a.kind);
  let missing: Missing | undefined;

  // Venue sound cutoff.
  const cutoff = ctx.cutoff.get(a.functionKind) ?? null;
  if (a.requiresAmplifiedMusic && cutoff !== null && end > cutoff) {
    violations.push({
      constraint: "music_cutoff",
      overByMin: end - cutoff,
      explanation: `${a.title} ends ${fmtMinute(end)}, ${end - cutoff} min after the ${fmtMinute(cutoff)} music cutoff.`,
      resolverText: "Venue owner (confirm or extend the music cutoff)",
      resolver: { role: "venue_owner" },
    });
  }

  // Video coverage window.
  const coverageAct = snapshot.activities.find((o) => o.kind === "coverage" && o.functionKind === a.functionKind);
  const coverageEnd = coverageEndFor(ctx, a.functionKind);
  if (isPerformance && coverageEnd !== null && end > coverageEnd) {
    violations.push({
      constraint: "coverage_end",
      overByMin: end - coverageEnd,
      explanation: `${a.title} runs to ${fmtMinute(end)}, ${end - coverageEnd} min past video coverage (${fmtMinute(coverageEnd)}).`,
      resolverText: "Videographer (extend coverage)",
      resolver: { role: "videographer" },
    });
  }
  if (isPerformance && coverageAct && start < coverageAct.start) {
    violations.push({
      constraint: "coverage_start",
      overByMin: coverageAct.start - start,
      explanation: `${a.title} starts ${fmtMinute(start)}, before video coverage begins (${fmtMinute(coverageAct.start)}).`,
      resolverText: "Videographer (start coverage earlier)",
      resolver: { role: "videographer" },
    });
  }

  // Overlaps and setup buffer against other activities.
  for (const o of snapshot.activities) {
    if (o.id === a.id || o.functionKind !== a.functionKind) continue;
    if (o.kind === "coverage" || a.kind === "coverage") continue;
    // When reporting, list each pair once, on the flexible activity (the one a proposal can move).
    // When placing a candidate, every other activity must be checked.
    if (mode === "report" && (a.flexible !== o.flexible ? !a.flexible : a.id > o.id)) continue;
    const ov = overlapMin(start, end, o.start, o.end);
    const allowedByKind = a.canOverlapWith?.includes(o.kind) || o.canOverlapWith?.includes(a.kind);
    if (ov > 0) {
      if (allowedByKind) continue;
      if (o.kind === "dinner" && isPerformance && policy.allowDanceDuringDinner) continue;
      violations.push({
        constraint: "overlap",
        overByMin: ov,
        explanation:
          o.kind === "dinner"
            ? `${a.title} overlaps dinner service (${fmtMinute(o.start)}) by ${ov} min.`
            : `${a.title} overlaps ${o.title} by ${ov} min.`,
        resolverText: o.kind === "dinner" ? `${who(o)}: allow dancing during dinner service` : "The planner (reschedule one of them)",
        resolver: o.kind === "dinner" ? whoResolver(o) : { role: "planner" },
      });
    } else if (isPerformance && PERFORMANCE_KINDS.includes(o.kind)) {
      const gap = start >= o.end ? start - o.end : o.start - end;
      if (gap < policy.setupBufferMin) {
        violations.push({
          constraint: "buffer",
          overByMin: policy.setupBufferMin - gap,
          explanation: `${a.title} leaves only ${gap} min of setup time next to ${o.title} (needs ${policy.setupBufferMin}).`,
          resolverText: "The planner (setup buffer)",
          resolver: { role: "planner" },
        });
      }
    }
  }

  // Makeup must be finished one buffer before a dance starts.
  if (a.kind === "dance") {
    const makeup = snapshot.activities
      .filter((o) => o.kind === "makeup" && o.functionKind === a.functionKind)
      .sort((x, y) => y.end - x.end)[0];
    if (makeup) {
      const need = start - policy.makeupBufferMin;
      const confirmed = ctx.makeupReady.get(a.functionKind) ?? null;
      if (confirmed !== null) {
        if (confirmed > need) {
          violations.push({
            constraint: "makeup_ready",
            overByMin: confirmed - need,
            explanation: `Makeup is confirmed to finish at ${fmtMinute(confirmed)}, but ${a.title} at ${fmtMinute(start)} needs it done by ${fmtMinute(need)}.`,
            resolverText: `${makeupArtist(makeup)} (makeup finish time)`,
            resolver: { role: "makeup_artist", name: makeupArtist(makeup) },
          });
        }
      } else if (need < makeup.end) {
        violations.push({
          constraint: "makeup_ready",
          overByMin: Math.max(makeup.end - need, 0),
          explanation: `${a.title} at ${fmtMinute(start)} needs makeup done by ${fmtMinute(need)}, before the planned ${fmtMinute(makeup.end)}.`,
          resolverText: `${makeupArtist(makeup)} (makeup finish time)`,
          resolver: { role: "makeup_artist", name: makeupArtist(makeup) },
        });
      } else if (need - makeup.end < policy.makeupBufferMin) {
        // Planned makeup only just fits and nobody has confirmed it.
        missing = {
          question: `Can ${makeupArtist(makeup)} finish makeup by ${fmtMinute(need)}?`,
          askWhom: makeupArtist(makeup),
          factKind: "makeup_ready",
          byMinute: need,
        };
      }
    }
  }

  return { violations, missing };
}

// ---------------------------------------------------------------- ranking

interface Candidate {
  activity: Activity;
  moves: Move[];
  costDeltaInr: number | null;
  satisfies: string[];
  reasons: Reason[];
  missing?: Missing;
  /** Sort inputs. */
  shift: number;
  start: number;
  dinnerPenalty: number;
  keepsOriginal: boolean;
  id: string;
}

const costKey = (c: Candidate) => (c.costDeltaInr === null ? Number.MAX_SAFE_INTEGER : c.costDeltaInr);

function comparator(strategy: CompilerPolicy["strategy"]) {
  return (a: Candidate, b: Candidate): number => {
    let r = 0;
    if (strategy === "preserve_family_priorities") {
      r =
        a.dinnerPenalty - b.dinnerPenalty ||
        Number(b.keepsOriginal) - Number(a.keepsOriginal) ||
        a.shift - b.shift ||
        costKey(a) - costKey(b);
    } else if (strategy === "minimize_changes") {
      r = a.moves.length - b.moves.length || a.shift - b.shift || costKey(a) - costKey(b);
    } else {
      r = costKey(a) - costKey(b) || a.shift - b.shift;
    }
    return r || a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };
}

/** Greedy pick of distinct options: moved activities of the same kind must not overlap. */
function pickDistinct(sorted: Candidate[], max: number): Candidate[] {
  const picked: Candidate[] = [];
  for (const c of sorted) {
    if (picked.length >= max) break;
    const clash = picked.some((p) => {
      if (p.moves[0].activityId !== c.moves[0].activityId) return false;
      const pm = p.moves[0].to;
      const cm = c.moves[0].to;
      return overlapMin(pm.start, pm.end, cm.start, cm.end) > 0;
    });
    if (!clash) picked.push(c);
  }
  return picked;
}

function describeSatisfies(
  ctx: Context,
  a: Activity,
  start: Minute,
  end: Minute,
  extendedCoverage: boolean,
): { satisfies: string[]; reasons: Reason[] } {
  const reasons: Reason[] = [];
  const dinner = ctx.snapshot.activities.find((o) => o.kind === "dinner" && o.functionKind === a.functionKind);
  if (dinner) {
    reasons.push({ code: "dinner_kept", at: dinner.start, noDanceDuring: !!dinner.requestedBy && overlapMin(start, end, dinner.start, dinner.end) === 0, by: requester(dinner) });
  }
  if (a.requestedBy) reasons.push({ code: "duration_kept", activityId: a.id, minutes: end - start, by: requester(a) });
  const cov = ctx.snapshot.activities.find((o) => o.kind === "coverage" && o.functionKind === a.functionKind);
  const covEnd = coverageEndFor(ctx, a.functionKind);
  if (cov && covEnd !== null && (extendedCoverage || (start >= cov.start && end <= covEnd))) reasons.push({ code: "video_covered" });

  const by = (r?: Requester) => (r ? ` (${r.memberName}, ${r.priority})` : "");
  const satisfies = reasons.map((r) => {
    if (r.code === "dinner_kept") return `Dinner service stays at ${fmtMinute(r.at)}${r.noDanceDuring ? " with no dance during it" : ""}${by(r.by)}`;
    if (r.code === "duration_kept") return `${a.title} keeps its ${r.minutes} min${by(r.by)}`;
    return "Fully covered on video";
  });
  return { satisfies, reasons };
}

// ---------------------------------------------------------------- compile

/**
 * The plan as the compiler sees it: a confirmed dinner_start fact places dinner service (keeping
 * its duration). Returns a copy and never mutates the input. Exported so UIs show the same times.
 */
export function withConfirmedTimes(input: Snapshot): Snapshot {
  return {
    ...input,
    activities: input.activities.map((a) => {
      if (a.kind !== "dinner") return a;
      const at = resolveFact(input.facts, "dinner_start", a.functionKind).value;
      return at === null || at === a.start ? a : { ...a, start: at, end: at + (a.end - a.start) };
    }),
  };
}

export const compile: Compile = (input: Snapshot, policy: CompilerPolicy): CompileResult => {
  const functionKinds = [...new Set(input.activities.map((a) => a.functionKind))].sort();
  const blocking: BlockingItem[] = [];
  const cutoff = new Map<string, number | null>();
  const coverageEnd = new Map<string, number | null>();
  const makeupReady = new Map<string, number | null>();
  const dinnerStart = new Map<string, number | null>();

  const overtime = new Map<string, number | null>();
  for (const fk of functionKinds) {
    for (const [kind, store] of [
      ["music_cutoff", cutoff],
      ["coverage_end", coverageEnd],
      ["makeup_ready", makeupReady],
      ["dinner_start", dinnerStart],
    ] as const) {
      const r = resolveFact(input.facts, kind, fk);
      store.set(fk, r.value);
      if (r.contradiction) {
        const values = [...new Set(r.contradiction.map((f) => f.value as number))].sort((x, y) => x - y);
        blocking.push({
          code: "contradiction",
          factKind: kind,
          values,
          constraint: `Contradictory ${kind.replaceAll("_", " ")} evidence (${values.map(fmtMinute).join(" vs ")})`,
          whoCanResolve: "The planner (re-confirm with the source and supersede the wrong answer)",
          resolver: { role: "planner" },
        });
      }
    }
    overtime.set(fk, resolveFact(input.facts, "overtime_rate", fk).value);
    const needsCutoff = input.activities.some((a) => a.functionKind === fk && a.requiresAmplifiedMusic);
    const cutoffRes = resolveFact(input.facts, "music_cutoff", fk);
    if (needsCutoff && cutoffRes.value === null && !cutoffRes.contradiction) {
      blocking.push({
        code: "cutoff_unconfirmed",
        constraint: "Music cutoff not yet confirmed",
        whoCanResolve: "Venue owner (ask when amplified music must stop)",
        resolver: { role: "venue_owner" },
      });
    }
  }

  const snapshot = withConfirmedTimes(input);
  const ctx: Context = { snapshot, policy, cutoff, coverageEnd, makeupReady };

  // 1. Conflicts of the activities as currently planned.
  const conflicts: Conflict[] = [];
  const acts = [...snapshot.activities].sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  for (const a of acts) {
    for (const v of evaluate(ctx, a, a.start, a.end, "report").violations) {
      conflicts.push({ activityId: a.id, constraint: v.constraint, overByMin: v.overByMin, explanation: v.explanation });
    }
  }

  // 2. Candidates for every flexible, conflicting activity.
  const feasible: Candidate[] = [];
  const conditional: Candidate[] = [];
  const blockedActivities: { a: Activity; failures: Violation[][] }[] = [];

  for (const a of acts.filter((x) => x.flexible && conflicts.some((c) => c.activityId === x.id))) {
    const duration = a.end - a.start;
    const dinner = snapshot.activities.find((o) => o.kind === "dinner" && o.functionKind === a.functionKind);
    const failures: Violation[][] = [];

    const make = (start: number, end: number, ev: Evaluation): Candidate => ({
      activity: a,
      id: `${a.id}@${fmtMinute(start)}`,
      moves: [{ activityId: a.id, from: { start: a.start, end: a.end }, to: { start, end } }],
      costDeltaInr: 0,
      ...describeSatisfies(ctx, a, start, end, false),
      missing: ev.missing,
      shift: Math.abs(start - a.start),
      start,
      dinnerPenalty:
        dinner?.requestedBy && overlapMin(start, end, dinner.start, dinner.end) > 0
          ? PRIORITY_WEIGHT[dinner.requestedBy.priority]
          : 0,
      keepsOriginal: false,
    });

    for (let start = 0; start + duration <= DAY_MIN; start += GRID_MIN) {
      if (start === a.start) continue;
      const end = start + duration;
      const ev = evaluate(ctx, a, start, end, "place");
      if (ev.violations.length > 0) {
        failures.push(ev.violations);
        continue;
      }
      (ev.missing ? conditional : feasible).push(make(start, end, ev));
    }

    // Alternative: keep the activity and extend video coverage (a change to confirm, with a cost).
    const atOriginal = evaluate(ctx, a, a.start, a.end, "place").violations;
    const coverageOnly = atOriginal.length > 0 && atOriginal.every((v) => v.constraint === "coverage_end");
    const cov = snapshot.activities.find((o) => o.kind === "coverage" && o.functionKind === a.functionKind);
    const covEnd = coverageEndFor(ctx, a.functionKind);
    if (coverageOnly && cov && covEnd !== null && a.end > covEnd) {
      // Measure the extension from the same coverage end that produced the conflict.
      const extra = a.end - covEnd;
      const rate = overtime.get(a.functionKind) ?? null;
      feasible.push({
        activity: a,
        id: `${cov.id}:extend-to-${fmtMinute(a.end)}`,
        moves: [{ activityId: cov.id, from: { start: cov.start, end: covEnd }, to: { start: cov.start, end: a.end } }],
        costDeltaInr: rate === null ? null : Math.round((rate * extra) / 60),
        ...describeSatisfies(ctx, a, a.start, a.end, true),
        shift: 0,
        start: a.start,
        dinnerPenalty: 0,
        keepsOriginal: true,
      });
    }

    blockedActivities.push({ a, failures });
  }

  // 3. Rank and cap.
  const cmp = comparator(policy.strategy);
  const max = Math.max(0, policy.maxProposals);
  const toProposal = (c: Candidate, rank: number): Proposal => ({
    id: c.id,
    moves: c.moves,
    costDeltaInr: c.costDeltaInr,
    satisfies: c.satisfies,
    reasons: c.reasons,
    rank,
  });
  const proposals = pickDistinct([...feasible].sort(cmp), max).map((c, i) => toProposal(c, i + 1));
  const conditionalOut: ConditionalProposal[] = pickDistinct([...conditional].sort(cmp), max).map((c, i) => ({
    ...toProposal(c, i + 1),
    missing: c.missing as Missing,
  }));

  // 4. Nothing fits: name the blocking constraints and who can resolve them.
  if (proposals.length === 0 && conditionalOut.length === 0) {
    for (const { a, failures } of blockedActivities) {
      const classes = (vs: Violation[]) => new Set(vs.map((v) => v.constraint));
      // A constraint is "binding" if relaxing it alone would admit some candidate.
      const sole = new Map<string, Violation>();
      for (const vs of failures) {
        const cs = classes(vs);
        if (cs.size === 1) sole.set([...cs][0], vs[0]);
      }
      const source = sole.size > 0 ? sole : new Map(failures.flat().map((v) => [v.constraint as string, v] as const));
      for (const [constraint, v] of [...source.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
        blocking.push({
          code: "no_slot",
          activityId: a.id,
          violated: constraint as Conflict["constraint"],
          constraint: `${a.title}: ${constraint.replaceAll("_", " ")}`,
          whoCanResolve: v.resolverText,
          resolver: v.resolver,
        });
      }
    }
  }
  // Fixed activities in conflict cannot be moved by us: someone has to decide.
  for (const c of conflicts) {
    const a = snapshot.activities.find((x) => x.id === c.activityId);
    if (a && !a.flexible) {
      blocking.push({
        code: "fixed_conflict",
        activityId: a.id,
        violated: c.constraint,
        overByMin: c.overByMin,
        constraint: `${a.title} is fixed but conflicts: ${c.explanation}`,
        whoCanResolve: who(a),
        resolver: whoResolver(a),
      });
    }
  }

  return { conflicts, proposals, conditional: conditionalOut, blocking: dedupe(blocking), policyVersion: policy.version };
};

function dedupe<T extends { constraint: string; whoCanResolve: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = `${x.constraint}|${x.whoCanResolve}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
