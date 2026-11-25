import { describe, expect, it } from "vitest";
import { compile } from "./compiler/compile";
import { demoSangeet } from "./compiler/fixtures/demo-sangeet";
import { DEFAULT_POLICY, type Fact, type Snapshot } from "./compiler/types";
import { applyProposal, buildRecap, COMPILER_VERSION, parseApproveInput, parseRespondInput, policyForRevision, revisionFingerprint, stableStringify, ttlCache } from "./revisions";

const t = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const cutoff = (value: number, id = "c1"): Fact => ({
  id, kind: "music_cutoff", functionKind: "sangeet", value, status: "confirmed",
  source: { channel: "samvaad_call", ref: "call", wording: "" }, supersedes: "f-cutoff",
});
const snap = (extra: Fact[] = []): Snapshot => {
  const s = structuredClone(demoSangeet);
  s.facts.push(...extra);
  return s;
};

describe("stableStringify", () => {
  it("ignores key order and undefined fields", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: undefined, e: [3, { z: 1, y: 2 }] } })).toBe(stableStringify({ a: { e: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }));
  });
});

describe("revisionFingerprint", () => {
  it("is stable for the same plan state, however it is ordered", () => {
    const a = snap([cutoff(t("22:00"))]);
    const b = structuredClone(a);
    b.activities.reverse();
    b.facts.reverse();
    expect(revisionFingerprint(a, DEFAULT_POLICY)).toBe(revisionFingerprint(b, DEFAULT_POLICY));
  });

  it("changes when new evidence arrives (a late vendor reply)", () => {
    expect(revisionFingerprint(snap([cutoff(t("22:00"))]), DEFAULT_POLICY)).not.toBe(revisionFingerprint(snap([cutoff(t("21:30"))]), DEFAULT_POLICY));
  });

  it("binds a makeup withdrawal to the stored revision", () => {
    const before = snap([cutoff(t("21:00"))]);
    const [option] = compile(before, DEFAULT_POLICY).conditional;
    expect(option.missing.byMinute).toBe(t("19:55"));
    const after = {
      ...before,
      withdrawnMakeupOptions: [{ functionKind: "sangeet", proposalId: option.id, readyBy: t("19:55") }],
    };
    expect(revisionFingerprint(after, DEFAULT_POLICY)).not.toBe(revisionFingerprint(before, DEFAULT_POLICY));
    expect(compile(after, DEFAULT_POLICY).conditional.map((proposal) => proposal.id)).not.toContain(option.id);
  });

  it("does not change when a vendor repeats an answer already on file", () => {
    const first = snap([cutoff(t("22:00"), "c1")]);
    const repeat = snap([cutoff(t("22:00"), "c1"), { ...cutoff(t("22:00"), "c2"), supersedes: "c1" }]);
    expect(revisionFingerprint(first, DEFAULT_POLICY)).toBe(revisionFingerprint(repeat, DEFAULT_POLICY));
  });

  it("changes when the compiler policy changes (Flagsmith)", () => {
    const s = snap([cutoff(t("22:00"))]);
    expect(revisionFingerprint(s, DEFAULT_POLICY)).not.toBe(revisionFingerprint(s, { ...DEFAULT_POLICY, strategy: "minimize_changes", version: "v2" }));
  });

  it("changes when an activity moves (after an approval)", () => {
    const s = snap([cutoff(t("22:00"))]);
    const moved = structuredClone(s);
    moved.activities.find((a) => a.id === "dance")!.start = t("21:40");
    expect(revisionFingerprint(s, DEFAULT_POLICY)).not.toBe(revisionFingerprint(moved, DEFAULT_POLICY));
  });
});

describe("applyProposal and buildRecap", () => {
  const s = snap([cutoff(t("22:00"))]);
  const policy = { ...DEFAULT_POLICY, allowDanceDuringDinner: true };
  const p = compile(s, policy).proposals.find((x) => x.moves[0].activityId === "dance")!;

  it("moves only the proposal's activities and does not mutate the input", () => {
    const before = structuredClone(s.activities);
    const after = applyProposal(s.activities, p);
    expect(s.activities).toEqual(before);
    const dance = after.find((a) => a.id === "dance")!;
    expect([dance.start, dance.end]).toEqual([p.moves[0].to.start, p.moves[0].to.end]);
    expect(after.filter((a) => a.id !== "dance")).toEqual(before.filter((a) => a.id !== "dance"));
  });

  it("the approved timeline has no conflict left for the moved activity", () => {
    const after = { ...s, activities: applyProposal(s.activities, p) };
    expect(compile(after, policy).conflicts.filter((c) => c.activityId === "dance")).toEqual([]);
  });

  it("the recap carries revision, moves with titles, cost and reasons", () => {
    const r = buildRecap(4, p, s.activities);
    expect(r.revision).toBe(4);
    expect(r.proposalId).toBe(p.id);
    expect(r.moves[0]).toMatchObject({ activityId: "dance", title: "Cousins' dance", from: { start: t("21:45"), end: t("22:05") } });
    expect(r.costDeltaInr).toBe(p.costDeltaInr);
    expect(r.reasons).toEqual(p.reasons);
  });
});

describe("request validation", () => {
  const ok = { revision: 3, proposalId: "dance@9:40 pm" };

  it("respond: accepts the three stances, trims the note", () => {
    for (const stance of ["agree", "prefer_other", "object"]) expect(parseRespondInput({ ...ok, stance }).ok).toBe(true);
    expect(parseRespondInput({ ...ok, stance: "agree", note: "  ok  " })).toEqual({ ok: true, value: { weddingId: undefined, revision: 3, proposalId: "dance@9:40 pm", stance: "agree", note: "ok" } });
  });

  it("respond: rejects unknown stances, approve-like stances and bad revisions", () => {
    expect(parseRespondInput({ ...ok, stance: "approve" })).toEqual({ ok: false, error: "bad_stance" });
    expect(parseRespondInput({ ...ok, revision: 0, stance: "agree" })).toEqual({ ok: false, error: "bad_revision" });
    expect(parseRespondInput({ ...ok, revision: "3", stance: "agree" })).toEqual({ ok: false, error: "bad_revision" });
    expect(parseRespondInput({ ...ok, proposalId: "", stance: "agree" })).toEqual({ ok: false, error: "bad_proposal" });
  });

  it("approve: needs a revision number and a proposal id", () => {
    expect(parseApproveInput(ok)).toEqual({ ok: true, value: { weddingId: undefined, revision: 3, proposalId: "dance@9:40 pm" } });
    expect(parseApproveInput({ proposalId: "x" })).toEqual({ ok: false, error: "bad_revision" });
    expect(parseApproveInput(null)).toEqual({ ok: false, error: "bad_body" });
    expect(parseApproveInput({ ...ok, weddingId: 5 })).toEqual({ ok: false, error: "bad_wedding" });
  });
});

describe("review fixes (issue #5)", () => {
  it("fix 2: during a Flagsmith outage the stored policy is kept, so no phantom revision appears", () => {
    const remote = { ...DEFAULT_POLICY, strategy: "minimize_changes" as const, version: "v3" };
    const outage = { source: "safe_defaults" as const, policy: DEFAULT_POLICY };
    const s = snap([cutoff(t("22:00"))]);
    expect(policyForRevision(outage, remote)).toBe(remote);
    expect(revisionFingerprint(s, policyForRevision(outage, remote))).toBe(revisionFingerprint(s, remote));
    // Flagsmith healthy: the remote value always wins, even over the stored one.
    expect(policyForRevision({ source: "flagsmith", policy: remote }, DEFAULT_POLICY)).toBe(remote);
    // No revision yet and an outage: the safe default.
    expect(policyForRevision(outage, null)).toBe(DEFAULT_POLICY);
  });

  it("fix 5: a compiler version bump changes the fingerprint, so stale stored proposals are not reused", () => {
    const s = snap([cutoff(t("22:00"))]);
    expect(revisionFingerprint(s, DEFAULT_POLICY)).toBe(revisionFingerprint(s, DEFAULT_POLICY, COMPILER_VERSION));
    expect(revisionFingerprint(s, DEFAULT_POLICY, COMPILER_VERSION + 1)).not.toBe(revisionFingerprint(s, DEFAULT_POLICY));
  });

  it("fix 4: ttlCache serves within the window and expires after it", () => {
    let now = 1000;
    const c = ttlCache<string>(5000, () => now);
    expect(c.get("w")).toBeUndefined();
    c.set("w", "flags");
    now += 4999;
    expect(c.get("w")).toBe("flags");
    now += 1;
    expect(c.get("w")).toBeUndefined();
    c.set("w", "fresh");
    expect(c.get("w")).toBe("fresh");
  });
});
