import { describe, expect, it } from "vitest";
import { canOpenStage, openStages, reachedStage, STAGES } from "./stages";

const allOn = { stage_sourcing: true, stage_booking: true, stage_guests: true, stage_day_of: true, stage_closeout: true };

describe("stages", () => {
  it("a sourcing wedding cannot open booking, guests, day-of or closeout (even with every flag on)", () => {
    for (const s of ["booking", "guests", "day_of", "closeout"] as const) expect(canOpenStage("sourcing", s, allOn)).toBe(false);
    expect(canOpenStage("sourcing", "sourcing", allOn)).toBe(true);
  });

  it("reaching a stage opens it only when its flag is on", () => {
    expect(canOpenStage("guests", "guests", allOn)).toBe(true);
    expect(canOpenStage("guests", "guests", { ...allOn, stage_guests: false })).toBe(false);
    expect(canOpenStage("guests", "guests", {})).toBe(false); // Flagsmith unreachable → safe defaults are all off
  });

  it("a later stage keeps the earlier ones open", () => {
    expect(openStages("day_of", allOn)).toEqual(["brief", "sourcing", "booking", "guests", "day_of"]);
    expect(openStages("closeout", allOn)).toEqual([...STAGES]);
  });

  it("the brief is always open; unknown stage values count as the earliest stage", () => {
    expect(canOpenStage("brief", "brief", {})).toBe(true);
    expect(reachedStage("nonsense", "brief")).toBe(true);
    expect(reachedStage("nonsense", "sourcing")).toBe(false);
  });

  it("changing the wedding's stage unlocks the next stage's screens", () => {
    expect(canOpenStage("booking", "guests", allOn)).toBe(false);
    expect(canOpenStage("guests", "guests", allOn)).toBe(true);
  });
});
