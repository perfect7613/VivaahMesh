import { describe, expect, it } from "vitest";
import { activityFromRow, activityToRow, liveFactIds, parseFactInput, typedFactRules } from "./plan-input";
import { demoSangeet } from "./compiler/fixtures/demo-sangeet";
import type { Activity } from "./compiler/types";

describe("parseFactInput (fix 7)", () => {
  const ok = { kind: "music_cutoff", functionKind: "sangeet", value: 1320, status: "confirmed" };

  it("accepts a valid fact", () => {
    expect(parseFactInput(ok)).toEqual({ ok: true, value: { weddingId: undefined, kind: "music_cutoff", functionKind: "sangeet", value: 1320, status: "confirmed", wording: "" } });
  });

  it.each([
    ["empty string", ""],
    ["false", false],
    ["numeric string", "1320"],
    ["fraction", 13.5],
    ["negative", -1],
    ["past midnight", 1441],
  ])("rejects value %s instead of storing it as a time", (_, value) => {
    expect(parseFactInput({ ...ok, value })).toEqual({ ok: false, error: "bad_value" });
  });

  it("requires a value for a confirmed fact, allows null when unresolved", () => {
    expect(parseFactInput({ ...ok, value: null })).toEqual({ ok: false, error: "confirmed_needs_value" });
    expect(parseFactInput({ ...ok, value: null, status: "unresolved" }).ok).toBe(true);
  });

  it("rejects bad shapes, kinds and statuses", () => {
    expect(parseFactInput(null)).toEqual({ ok: false, error: "bad_body" });
    expect(parseFactInput([ok])).toEqual({ ok: false, error: "bad_body" });
    expect(parseFactInput({ ...ok, kind: "drop_table" })).toEqual({ ok: false, error: "bad_kind" });
    expect(parseFactInput({ ...ok, status: "approved" })).toEqual({ ok: false, error: "bad_status" });
    expect(parseFactInput({ ...ok, functionKind: " " })).toEqual({ ok: false, error: "bad_function" });
    expect(parseFactInput({ ...ok, weddingId: 7 })).toEqual({ ok: false, error: "bad_wedding" });
  });

  it("allows large rupee amounts only for overtime_rate", () => {
    expect(parseFactInput({ ...ok, kind: "overtime_rate", value: 6000 }).ok).toBe(true);
    expect(parseFactInput({ ...ok, value: 6000 }).ok).toBe(false);
  });
});

describe("liveFactIds (fix 5)", () => {
  it("returns every live fact, so all contradicting answers get superseded", () => {
    const rows = [
      { id: "seed", supersedes: [] },
      { id: "a", supersedes: ["seed"] },
      { id: "b", supersedes: [] },
    ];
    expect(liveFactIds(rows)).toEqual(["a", "b"]);
  });

  it("handles null supersedes and an empty history", () => {
    expect(liveFactIds([{ id: "x", supersedes: null }])).toEqual(["x"]);
    expect(liveFactIds([])).toEqual([]);
  });
});

describe("activity row mapping (fix 8)", () => {
  it("round-trips every demo activity unchanged", () => {
    for (const a of demoSangeet.activities) expect(activityFromRow(activityToRow(a))).toEqual(a);
  });

  it("keeps canOverlapWith through the database row", () => {
    const a: Activity = { id: "shehnai", functionKind: "sangeet", title: "Shehnai", kind: "other", start: 1230, end: 1260, flexible: true, canOverlapWith: ["dinner", "makeup"] };
    expect(activityToRow(a).can_overlap_with).toEqual(["dinner", "makeup"]);
    expect(activityFromRow(activityToRow(a))).toEqual(a);
  });

  it("drops unknown kinds and treats null/empty as 'no overlaps allowed'", () => {
    const row = { ...activityToRow(demoSangeet.activities[0]), can_overlap_with: ["dinner", "rocket"] };
    expect(activityFromRow(row).canOverlapWith).toEqual(["dinner"]);
    expect(activityFromRow({ ...row, can_overlap_with: null }).canOverlapWith).toBeUndefined();
    expect(activityFromRow({ ...row, can_overlap_with: [] }).canOverlapWith).toBeUndefined();
  });
});

describe("typedFactRules (vendor terms are never confirmed by hand)", () => {
  it("a typed vendor term is stored as conditional and may only replace typed answers", () => {
    for (const kind of ["music_cutoff", "coverage_end", "overtime_rate"] as const) {
      expect(typedFactRules(kind, "confirmed")).toEqual({ status: "conditional", replaceOnlyTyped: true });
      expect(typedFactRules(kind, "unresolved")).toEqual({ status: "unresolved", replaceOnlyTyped: true });
    }
  });

  it("the family's own times can be confirmed by hand and replace what is in force", () => {
    for (const kind of ["makeup_ready", "dinner_start"] as const) {
      expect(typedFactRules(kind, "confirmed")).toEqual({ status: "confirmed", replaceOnlyTyped: false });
    }
  });
});
