/** Pure lifecycle rules (no I/O), shared by the server and tests. */

export const STAGES = ["brief", "sourcing", "booking", "guests", "day_of", "closeout"] as const;
export type Stage = (typeof STAGES)[number];
export type Area = Exclude<Stage, "brief">;

/**
 * Which screens a wedding may open. Flagsmith decides (`stage_<area>` flags, segments on the
 * `wedding_stage` trait). If Flagsmith is unreachable, the same rule applies from the stored stage:
 * an area opens only once the wedding has reached it.
 */
export function areaOpen(area: Area, stage: string, flags: { source: string; on: Record<string, boolean> }): boolean {
  if (flags.source === "flagsmith" && `stage_${area}` in flags.on) return !!flags.on[`stage_${area}`];
  return STAGES.indexOf(stage as Stage) >= STAGES.indexOf(area);
}

export function nextStage(stage: string): Stage | null {
  const i = STAGES.indexOf(stage as Stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

export interface SpendVendor {
  id: string;
  name: string;
  status: string;
  functions: string[];
  planned_inr: number | null;
  committed_inr: number | null;
  invoice_inr: number | null;
  paid_inr: number;
}

/**
 * Planned, committed and actual spend, each counted once per vendor (a three-function package is
 * one line, not three). Invoices that differ from the approved (committed) amount are flagged.
 */
export function spendSummary(vendors: SpendVendor[]) {
  const live = vendors.filter((v) => v.status !== "cancelled");
  const sum = (f: (v: SpendVendor) => number | null) => live.reduce((t, v) => t + (f(v) ?? 0), 0);
  return {
    planned: sum((v) => v.planned_inr),
    committed: sum((v) => (v.status === "authorized" || v.status === "accepted" ? v.committed_inr : 0)),
    actual: sum((v) => v.paid_inr),
    discrepancies: live
      .filter((v) => v.invoice_inr != null && v.committed_inr != null && v.invoice_inr !== v.committed_inr)
      .map((v) => ({ vendorId: v.id, name: v.name, committed: v.committed_inr!, invoice: v.invoice_inr!, diff: v.invoice_inr! - v.committed_inr! })),
  };
}

/** Attendance and meal counts per function: an RSVP to the Sangeet never changes the ceremony's numbers. */
export function rsvpCounts(rsvps: { function_id: string; attending: boolean; people: number; veg: number }[]) {
  const out: Record<string, { yes: number; no: number; people: number; veg: number; nonVeg: number }> = {};
  for (const r of rsvps) {
    const c = (out[r.function_id] ??= { yes: 0, no: 0, people: 0, veg: 0, nonVeg: 0 });
    if (r.attending) {
      c.yes++;
      c.people += r.people;
      c.veg += Math.min(r.veg, r.people);
      c.nonVeg += Math.max(0, r.people - r.veg);
    } else c.no++;
  }
  return out;
}

/** A deliverable (wedding film, album) stays open after the ceremony until it is actually delivered. */
export function openAfterWedding(tasks: { kind: string; status: string }[]) {
  return tasks.filter((t) => t.kind === "deliverable" && t.status !== "done");
}
