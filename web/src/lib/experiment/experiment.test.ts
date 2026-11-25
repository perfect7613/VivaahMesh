import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { report, runAll } from "./score";

test("caller-prompt experiment replays 5 scenarios × 2 variants", () => {
  const { logs } = runAll();
  expect(logs).toHaveLength(10);
  // Safety rule independent of the variant: an owner who doesn't know never yields a confirmed cutoff.
  expect(logs.filter((l) => l.scenario === "unknown").every((l) => l.unresolved)).toBe(true);
  if (process.env.WRITE_EXPERIMENT_REPORT) writeFileSync(resolve(__dirname, "../../../../docs/caller-experiment.md"), report());
});
