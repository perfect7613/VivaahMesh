import { describe, expect, test } from "vitest";
import { areaOpen, nextStage, openAfterWedding, rsvpCounts, spendSummary } from "./lifecycle";

const fallback = { source: "safe_defaults", on: {} };

describe("stage gating (#11)", () => {
  test("a sourcing wedding cannot open booking or closeout", () => {
    expect(areaOpen("sourcing", "sourcing", fallback)).toBe(true);
    expect(areaOpen("booking", "sourcing", fallback)).toBe(false);
    expect(areaOpen("closeout", "sourcing", fallback)).toBe(false);
  });
  test("Flagsmith decides when it answers", () => {
    expect(areaOpen("booking", "sourcing", { source: "flagsmith", on: { stage_booking: true } })).toBe(true);
    expect(areaOpen("guests", "closeout", { source: "flagsmith", on: { stage_guests: false } })).toBe(false);
  });
  test("stages advance in order and stop at closeout", () => {
    expect(nextStage("brief")).toBe("sourcing");
    expect(nextStage("closeout")).toBeNull();
  });
});

describe("spend (#13, #14)", () => {
  const v = (o: Partial<Parameters<typeof spendSummary>[0][number]>) => ({ id: "x", name: "x", status: "accepted", functions: [], planned_inr: null, committed_inr: null, invoice_inr: null, paid_inr: 0, ...o });
  test("a multi-function package is counted once", () => {
    const s = spendSummary([v({ functions: ["haldi", "sangeet", "ceremony"], planned_inr: 300000, committed_inr: 280000, paid_inr: 100000 })]);
    expect(s).toMatchObject({ planned: 300000, committed: 280000, actual: 100000 });
  });
  test("planned, committed and actual stay separate; cancelled vendors drop out", () => {
    const s = spendSummary([v({ status: "shortlisted", planned_inr: 50000, committed_inr: 45000 }), v({ status: "cancelled", planned_inr: 90000, paid_inr: 10000 })]);
    expect(s).toMatchObject({ planned: 50000, committed: 0, actual: 0 });
  });
  test("an invoice above the approved amount is flagged", () => {
    expect(spendSummary([v({ id: "dj", name: "DJ", committed_inr: 40000, invoice_inr: 46000 })]).discrepancies).toEqual([{ vendorId: "dj", name: "DJ", committed: 40000, invoice: 46000, diff: 6000 }]);
  });
});

describe("RSVPs per function (#12)", () => {
  test("a Sangeet RSVP only changes the Sangeet's numbers", () => {
    const c = rsvpCounts([{ function_id: "sangeet", attending: true, people: 4, veg: 3 }, { function_id: "ceremony", attending: false, people: 0, veg: 0 }]);
    expect(c.sangeet).toEqual({ yes: 1, no: 0, people: 4, veg: 3, nonVeg: 1 });
    expect(c.ceremony).toEqual({ yes: 0, no: 1, people: 0, veg: 0, nonVeg: 0 });
  });
});

describe("closeout (#14)", () => {
  test("a missing wedding film keeps its delivery task open after the ceremony", () => {
    expect(openAfterWedding([{ kind: "deliverable", status: "open" }, { kind: "task", status: "open" }, { kind: "deliverable", status: "done" }])).toHaveLength(1);
  });
});
