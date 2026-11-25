import { describe, expect, it } from "vitest";
import { parseClock } from "./clock";

describe("parseClock", () => {
  it.each([
    ["22:00", 1320],
    ["10 pm", 1320],
    ["10:30 PM", 1350],
    ["10", 1320],
    ["9:30", 1290],
    ["21:30", 1290],
    ["12 am", 0],
  ])("%s → %i", (raw, want) => expect(parseClock(raw)).toBe(want));

  it.each(["", "unknown", "late", "25:00", "10:75", "around ten"])("unclear %j stays null", (raw) => expect(parseClock(raw)).toBeNull());
});
