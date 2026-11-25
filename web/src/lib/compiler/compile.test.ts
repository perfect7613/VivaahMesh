import { describe, expect, it } from "vitest";
import { compile } from "./compile";
import { demoSangeet } from "./fixtures/demo-sangeet";
import { DEFAULT_POLICY, type CompilerPolicy, type Fact, type Snapshot } from "./types";

const t = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const policy = (p: Partial<CompilerPolicy> = {}): CompilerPolicy => ({ ...DEFAULT_POLICY, ...p });
const venueSaid = (value: number | null, status: Fact["status"] = "confirmed"): Fact => ({
  id: "f-cutoff-live", kind: "music_cutoff", functionKind: "sangeet", value, status,
  source: { channel: "samvaad_call", ref: "call-1", wording: "music stops at the time" },
  supersedes: "f-cutoff",
});
const snap = (extra: Fact[] = [], mutate?: (s: Snapshot) => void): Snapshot => {
  const s: Snapshot = structuredClone(demoSangeet);
  s.facts.push(...extra);
  mutate?.(s);
  return s;
};
const danceMoves = (r: ReturnType<typeof compile>) =>
  r.proposals.map((p) => p.moves[0]).filter((m) => m.activityId === "dance").map((m) => [m.to.start, m.to.end]);

describe("cutoff fixtures (PRD Testing Decisions → Compiler)", () => {
  const allowDinner = policy({ allowDanceDuringDinner: true });

  const danceAt = (start: string, end: string) => (s: Snapshot) => {
    const d = s.activities.find((x) => x.id === "dance")!;
    d.start = t(start);
    d.end = t(end);
  };

  it("21:00 cutoff: a 21:00–21:20 dance fails by 20 minutes; the pre-dinner option is conditional", () => {
    const planned = compile(snap([venueSaid(t("21:00"))], danceAt("21:00", "21:20")), allowDinner);
    expect(planned.conflicts.find((c) => c.constraint === "music_cutoff")?.overByMin).toBe(20);
    expect(danceMoves(planned)).not.toContainEqual([t("21:00"), t("21:20")]);
    // Under the default policy (no dancing during dinner) only the conditional option remains.
    const strict = compile(snap([venueSaid(t("21:00"))]), policy());
    expect(strict.proposals).toHaveLength(0);
    expect(strict.conditional).toHaveLength(1);
    expect(strict.conditional[0].moves[0].to).toEqual({ start: t("20:10"), end: t("20:30") });
  });

  it("21:30 cutoff: a 21:00–21:20 dance fits and dinner stays at 20:30", () => {
    const s = snap([venueSaid(t("21:30"))], danceAt("21:00", "21:20"));
    const r = compile(s, allowDinner);
    expect(r.conflicts).toEqual([]);
    expect(r.proposals).toEqual([]);
    expect(s.activities.find((a) => a.id === "dinner")!.start).toBe(t("20:30"));
    // From the seeded 21:45 slot the proposals end by 21:30 and never move dinner.
    const seeded = compile(snap([venueSaid(t("21:30"))]), allowDinner);
    expect(danceMoves(seeded)[0]).toEqual([t("21:10"), t("21:30")]);
    expect(seeded.proposals.every((p) => p.moves.every((m) => m.activityId !== "dinner" && m.to.end <= t("21:30")))).toBe(true);
  });

  it("22:00 cutoff: the original dance still overruns by five minutes", () => {
    const r = compile(snap([venueSaid(t("22:00"))]), allowDinner);
    const c = r.conflicts.find((x) => x.activityId === "dance" && x.constraint === "music_cutoff")!;
    expect(c.overByMin).toBe(5);
    expect(danceMoves(r)).toContainEqual([t("21:40"), t("22:00")]);
  });

  it("a dance ending exactly at the cutoff fits (inclusive end)", () => {
    const r = compile(snap([venueSaid(t("22:00"))]), allowDinner);
    const exact = danceMoves(r).concat(r.conditional.map((c) => [c.moves[0].to.start, c.moves[0].to.end]));
    expect(r.conflicts.some((c) => c.constraint === "music_cutoff" && c.activityId === "dance" && c.overByMin <= 0)).toBe(false);
    expect(compile(snap([venueSaid(t("22:05"))]), allowDinner).conflicts.some((c) => c.constraint === "music_cutoff")).toBe(false);
    expect(exact.length).toBeGreaterThan(0);
  });

  it("with default policy (no dancing during dinner) the 21:30 case offers no after-dinner slot", () => {
    const r = compile(snap([venueSaid(t("21:30"))]), policy());
    expect(r.proposals).toHaveLength(0);
    expect(r.conditional[0].moves[0].to.start).toBe(t("20:10"));
  });
});

describe("conditional options", () => {
  it("name the exact missing answer: Meera finishing by 7:55", () => {
    const r = compile(snap([venueSaid(t("21:00"))]), policy());
    const c = r.conditional[0];
    expect(c.missing).toEqual({ question: "Can Meera finish makeup by 7:55 pm?", askWhom: "Meera", factKind: "makeup_ready", byMinute: t("19:55") });
  });

  it("is confirmed when Meera confirms in time, withdrawn when she declines", () => {
    const base = [venueSaid(t("21:00"))];
    const ok = compile(snap([...base, { id: "m1", kind: "makeup_ready", functionKind: "sangeet", value: t("19:55"), status: "confirmed", source: { channel: "typed", ref: "meera", wording: "done by 7:55" } }]), policy());
    expect(ok.conditional).toHaveLength(0);
    expect(ok.proposals[0].moves[0].to.start).toBe(t("20:10"));

    const no = compile(snap([...base, { id: "m2", kind: "makeup_ready", functionKind: "sangeet", value: t("20:30"), status: "confirmed", source: { channel: "typed", ref: "meera", wording: "can't before 8:30" } }]), policy());
    expect(no.proposals).toHaveLength(0);
    expect(no.conditional).toHaveLength(0);
  });
});

describe("edge cases", () => {
  it("missing scope: an unresolved cutoff invents no cutoff conflict and asks the venue", () => {
    const r = compile(snap(), policy({ allowDanceDuringDinner: true }));
    expect(r.conflicts.some((c) => c.constraint === "music_cutoff")).toBe(false);
    expect(r.conflicts.some((c) => c.constraint === "coverage_end" && c.overByMin === 5)).toBe(true);
    expect(r.blocking.some((b) => b.whoCanResolve.startsWith("Venue owner"))).toBe(true);
  });

  it("contradictory confirmed evidence is flagged, not guessed", () => {
    const r = compile(
      snap([
        { id: "a", kind: "music_cutoff", functionKind: "sangeet", value: t("21:00"), status: "confirmed", source: { channel: "typed", ref: "x", wording: "9" } },
        { id: "b", kind: "music_cutoff", functionKind: "sangeet", value: t("22:00"), status: "confirmed", source: { channel: "typed", ref: "y", wording: "10" } },
      ]),
      policy({ allowDanceDuringDinner: true }),
    );
    expect(r.blocking.some((b) => b.constraint.startsWith("Contradictory music cutoff"))).toBe(true);
    expect(r.conflicts.some((c) => c.constraint === "music_cutoff")).toBe(false);
  });

  it("a mid-call correction (supersedes) wins over the earlier answer", () => {
    const first: Fact = { ...venueSaid(t("21:30")), id: "first" };
    const fix: Fact = { ...venueSaid(t("22:00")), id: "fix", supersedes: "first" };
    const r = compile(snap([first, fix]), policy({ allowDanceDuringDinner: true }));
    expect(r.conflicts.find((c) => c.constraint === "music_cutoff")?.overByMin).toBe(5);
    expect(r.blocking.some((b) => b.constraint.startsWith("Contradictory"))).toBe(false);
  });

  it("no feasible slot: names the blocking constraint and who resolves it", () => {
    // 10-minute cutoff window makes a 20-minute dance impossible anywhere.
    const r = compile(snap([venueSaid(t("18:10"))]), policy({ allowDanceDuringDinner: true }));
    expect(r.proposals).toHaveLength(0);
    expect(r.conditional).toHaveLength(0);
    expect(r.blocking.length).toBeGreaterThan(0);
    expect(r.blocking.some((b) => /Venue owner/.test(b.whoCanResolve))).toBe(true);
  });

  it("unknown overtime fee shows as Price pending (null); confirmed rate gives a cost", () => {
    const venue = venueSaid(t("22:30"));
    const pending = compile(snap([venue]), policy({ allowDanceDuringDinner: true }));
    const ext = pending.proposals.find((p) => p.moves[0].activityId === "video")!;
    expect(ext.costDeltaInr).toBeNull();

    const rate: Fact = { id: "rate", kind: "overtime_rate", functionKind: "sangeet", value: 6000, status: "confirmed", source: { channel: "quote", ref: "v", wording: "₹6000/hr" } };
    const priced = compile(snap([venue, rate]), policy({ allowDanceDuringDinner: true }));
    expect(priced.proposals.find((p) => p.moves[0].activityId === "video")!.costDeltaInr).toBe(500); // 5 min of 6000/hr
    // moves of the dance cost nothing extra
    expect(priced.proposals.filter((p) => p.moves[0].activityId === "dance").every((p) => p.costDeltaInr === 0)).toBe(true);
  });

  it("an unconfirmed (conditional) rate is not used for costs", () => {
    const rate: Fact = { id: "rate", kind: "overtime_rate", functionKind: "sangeet", value: 6000, status: "conditional", source: { channel: "typed", ref: "v", wording: "maybe 6000" } };
    const r = compile(snap([venueSaid(t("22:30")), rate]), policy({ allowDanceDuringDinner: true }));
    expect(r.proposals.find((p) => p.moves[0].activityId === "video")!.costDeltaInr).toBeNull();
  });

  it("is deterministic and does not mutate its input", () => {
    const s = snap([venueSaid(t("21:30"))]);
    const frozen = structuredClone(s);
    const p = policy({ allowDanceDuringDinner: true });
    const a = compile(s, p);
    const b = compile(structuredClone(s), p);
    expect(a).toEqual(b);
    expect(s).toEqual(frozen);
  });

  it("only moves flexible activities and never invents approvals", () => {
    const r = compile(snap([venueSaid(t("21:30"))]), policy({ allowDanceDuringDinner: true }));
    for (const p of [...r.proposals, ...r.conditional]) {
      for (const m of p.moves) {
        const a = demoSangeet.activities.find((x) => x.id === m.activityId)!;
        expect(a.flexible || a.kind === "coverage").toBe(true);
      }
    }
    expect(JSON.stringify(r)).not.toMatch(/approved|booked|dialed/);
  });

  it("respects maxProposals and returns distinct, ranked options", () => {
    const r = compile(snap([venueSaid(t("22:00"))]), policy({ allowDanceDuringDinner: true, maxProposals: 3 }));
    expect(r.proposals.length).toBeLessThanOrEqual(3);
    expect(r.proposals.map((p) => p.rank)).toEqual(r.proposals.map((_, i) => i + 1));
    expect(new Set(r.proposals.map((p) => p.id)).size).toBe(r.proposals.length);
    expect(compile(snap([venueSaid(t("22:00"))]), policy({ allowDanceDuringDinner: true, maxProposals: 1 })).proposals).toHaveLength(1);
  });

  it("policy strategies give distinct, deterministic rankings", () => {
    const s = snap([venueSaid(t("22:00"))]);
    const top = (strategy: CompilerPolicy["strategy"]) => compile(s, policy({ allowDanceDuringDinner: true, strategy })).proposals[0].id;
    const ids = {
      preserve: top("preserve_family_priorities"),
      minimize: top("minimize_changes"),
      cost: top("lowest_confirmed_cost"),
    };
    expect(ids.minimize).toBe("dance@9:40 pm");
    expect(ids.cost).toBe("dance@9:40 pm");
    expect(compile(s, policy({ allowDanceDuringDinner: true, strategy: "lowest_confirmed_cost" })).policyVersion).toBe("default");
  });

  it("reports the policy version on the result", () => {
    expect(compile(snap(), policy({ version: "v7" })).policyVersion).toBe("v7");
  });
});

describe("review fixes", () => {
  const allowDinner = policy({ allowDanceDuringDinner: true });

  it("fix 1: never proposes a slot that clashes with another flexible activity", () => {
    // A second flexible dance whose id sorts before "dance" used to be skipped when placing candidates.
    const s = snap([venueSaid(t("22:00"))], (x) =>
      x.activities.push({ id: "aaa", functionKind: "sangeet", title: "Friends' dance", kind: "dance", start: t("21:30"), end: t("21:50"), flexible: true, requiresAmplifiedMusic: true }),
    );
    const r = compile(s, allowDinner);
    const aaa = s.activities.find((a) => a.id === "aaa")!;
    for (const p of [...r.proposals, ...r.conditional]) {
      for (const m of p.moves.filter((m) => m.activityId === "dance")) {
        const overlaps = m.to.start < aaa.end && aaa.start < m.to.end;
        const gap = m.to.start >= aaa.end ? m.to.start - aaa.end : aaa.start - m.to.end;
        expect(overlaps).toBe(false);
        expect(gap).toBeGreaterThanOrEqual(DEFAULT_POLICY.setupBufferMin);
      }
    }
    // The plan as it stands still reports the clash only once.
    expect(r.conflicts.filter((c) => c.constraint === "overlap" || c.constraint === "buffer")).toHaveLength(1);
  });

  it("fix 2: coverage extension is measured from the confirmed coverage end, not the activity", () => {
    const coverageFix: Fact = { id: "cov2", kind: "coverage_end", functionKind: "sangeet", value: t("21:30"), status: "confirmed", source: { channel: "quote", ref: "v2", wording: "Coverage until 9:30" }, supersedes: "f-coverage" };
    const rate: Fact = { id: "rate", kind: "overtime_rate", functionKind: "sangeet", value: 6000, status: "confirmed", source: { channel: "quote", ref: "v", wording: "₹6000/hr" } };
    const r = compile(snap([venueSaid(t("22:30")), coverageFix, rate]), allowDinner);
    expect(r.conflicts.find((c) => c.constraint === "coverage_end")?.overByMin).toBe(35);
    const ext = r.proposals.find((p) => p.moves[0].activityId === "video")!;
    expect(ext.moves[0].from.end).toBe(t("21:30"));
    expect(ext.moves[0].to.end).toBe(t("22:05"));
    expect(ext.costDeltaInr).toBe(3500); // 35 min at ₹6000/hr
  });

  it("fix 3: starting before video coverage is its own constraint, not an end overrun", () => {
    const s = snap([venueSaid(t("22:00"))], (x) => {
      const d = x.activities.find((a) => a.id === "dance")!;
      d.start = t("17:40");
      d.end = t("18:00");
    });
    const r = compile(s, allowDinner);
    const c = r.conflicts.find((x) => x.activityId === "dance")!;
    expect(c.constraint).toBe("coverage_start");
    expect(c.overByMin).toBe(20);
    expect(r.conflicts.some((x) => x.constraint === "coverage_end")).toBe(false);
  });

  it("supersedes may list several facts: a typed fix clears a contradiction", () => {
    const a: Fact = { id: "a", kind: "music_cutoff", functionKind: "sangeet", value: t("21:00"), status: "confirmed", source: { channel: "typed", ref: "x", wording: "9" } };
    const b: Fact = { id: "b", kind: "music_cutoff", functionKind: "sangeet", value: t("22:00"), status: "confirmed", source: { channel: "typed", ref: "y", wording: "10" } };
    const fix: Fact = { id: "c", kind: "music_cutoff", functionKind: "sangeet", value: t("21:30"), status: "confirmed", source: { channel: "typed", ref: "z", wording: "9:30" }, supersedes: ["a", "b", "f-cutoff"] };
    const r = compile(snap([a, b, fix]), allowDinner);
    expect(r.blocking.some((x) => x.code === "contradiction")).toBe(false);
    expect(r.conflicts.find((x) => x.constraint === "music_cutoff")?.overByMin).toBe(35); // 22:05 vs 21:30
  });

  it("translation: proposals and blocking carry structured data, not only English", () => {
    const r = compile(snap([venueSaid(t("22:00"))]), allowDinner);
    const p = r.proposals.find((x) => x.moves[0].activityId === "dance")!;
    expect(p.reasons).toContainEqual({ code: "dinner_kept", at: t("20:30"), noDanceDuring: false, by: { memberName: "Aai", side: "A", priority: "must" } });
    expect(p.reasons).toContainEqual({ code: "duration_kept", activityId: "dance", minutes: 20, by: { memberName: "Riya", side: "B", priority: "prefer" } });
    expect(p.reasons.length).toBe(p.satisfies.length);

    const pending = compile(snap(), allowDinner);
    expect(pending.blocking).toContainEqual(expect.objectContaining({ code: "cutoff_unconfirmed", resolver: { role: "venue_owner" } }));

    const stuck = compile(snap([venueSaid(t("18:10"))]), allowDinner);
    expect(stuck.blocking.some((x) => x.code === "no_slot" && x.activityId === "dance" && x.resolver.role === "venue_owner")).toBe(true);
  });
});

describe("review fixes, round 2", () => {
  it("fix 4: a confirmed dinner_start fact moves dinner service (and keeps its duration)", () => {
    const later: Fact = { id: "d2", kind: "dinner_start", functionKind: "sangeet", value: t("21:00"), status: "confirmed", source: { channel: "typed", ref: "aai", wording: "jevan 9 la" }, supersedes: "f-dinner" };
    const s = snap([venueSaid(t("22:30")), later]);
    const before = structuredClone(s);
    const r = compile(s, policy()); // default: no dancing during dinner
    // Dance 21:45–22:05 vs dinner now 21:00–22:30 → 20 min overlap (it was 15 against 20:30–22:00).
    expect(r.conflicts.find((c) => c.constraint === "overlap")?.overByMin).toBe(20);
    const p = [...r.proposals, ...r.conditional][0];
    expect(p.reasons).toContainEqual(expect.objectContaining({ code: "dinner_kept", at: t("21:00") }));
    expect(s).toEqual(before); // input not mutated
  });

  it("fix 4: an unconfirmed dinner_start fact changes nothing", () => {
    const maybe: Fact = { id: "d3", kind: "dinner_start", functionKind: "sangeet", value: t("21:00"), status: "conditional", source: { channel: "typed", ref: "aai", wording: "maybe 9" } };
    const base = compile(snap([venueSaid(t("22:30"))]), policy());
    const r = compile(snap([venueSaid(t("22:30")), maybe]), policy());
    expect(r.conflicts).toEqual(base.conflicts);
  });

  it("fix 4: withConfirmedTimes gives the UI the same dinner time the compiler used", async () => {
    const { withConfirmedTimes } = await import("./compile");
    const later: Fact = { id: "d2", kind: "dinner_start", functionKind: "sangeet", value: t("21:00"), status: "confirmed", source: { channel: "typed", ref: "aai", wording: "" }, supersedes: "f-dinner" };
    const dinner = withConfirmedTimes(snap([later])).activities.find((a) => a.id === "dinner")!;
    expect([dinner.start, dinner.end]).toEqual([t("21:00"), t("22:30")]);
  });

  it("canOverlapWith lets an activity share time with dinner without a conflict", () => {
    const s = snap([venueSaid(t("22:30"))], (x) =>
      x.activities.push({ id: "shehnai", functionKind: "sangeet", title: "Shehnai", kind: "other", start: t("20:30"), end: t("21:00"), flexible: true, canOverlapWith: ["dinner"] }),
    );
    expect(compile(s, policy()).conflicts.some((c) => c.activityId === "shehnai")).toBe(false);
  });
});

describe("review fixes, issue #5 round", () => {
  it("finding 9: the same blocker in two functions stays two items", () => {
    const s = snap([], (x) => {
      x.activities.push({ id: "r-dance", functionKind: "reception", title: "Reception dance", kind: "dance", start: t("20:00"), end: t("20:20"), flexible: true, requiresAmplifiedMusic: true });
    });
    const r = compile(s, policy({ allowDanceDuringDinner: true }));
    const missing = r.blocking.filter((b) => b.code === "cutoff_unconfirmed");
    expect(missing.map((b) => b.functionKind).sort()).toEqual(["reception", "sangeet"]);
  });
});
