import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { SCENARIOS } from "./scenarios";
import { report, runAll, runOne } from "./score";

test("caller-prompt experiment replays 5 scenarios × 2 variants", () => {
  const { logs } = runAll();
  expect(logs).toHaveLength(10);
  // Safety rule independent of the variant: an owner who doesn't know never yields a confirmed cutoff.
  expect(logs.filter((l) => l.scenario === "unknown").every((l) => l.unresolved)).toBe(true);
  if (process.env.WRITE_EXPERIMENT_REPORT) writeFileSync(resolve(__dirname, "../../../../docs/caller-experiment.md"), report());
});

test("a spare scripted answer is ignored until the caller asks a follow-up", () => {
  const clear = SCENARIOS[0];
  const extra = { ...clear, answers: { ...clear.answers, baseline: [...clear.answers.baseline, "Actually, midnight."] } };
  expect(runOne(extra, "baseline")).toEqual(runOne(clear, "baseline"));
  const scope = SCENARIOS.find((scenario) => scenario.id === "scope")!;
  expect(runOne(scope, "baseline").unsupportedChange).toBe(true);
  expect(runOne(scope, "clarify_scope").unresolved).toBe(true);
});
