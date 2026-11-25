import { test } from "vitest";
import assert from "node:assert/strict";
import { demoSangeet } from "../src/lib/compiler/fixtures/demo-sangeet.ts";
import { applyFamilyRequirements, approvedRecapText, planTime, requirementLabel } from "../src/lib/family-plan.ts";

test("reviewed duration and dinner apply by canonical function and preserve other events", () => {
  const requirements = [
    { id: "A", kind: "dinner_start", functionKind: "sangeet", value: 1245, note: "जेवण", source: "dictate", author: "Aai", version: 2 },
    { id: "B", kind: "dance_duration", functionKind: "sangeet", value: 15, note: "", source: "typed", author: "Riya", version: 1 },
  ];
  const edited = applyFamilyRequirements(demoSangeet, requirements);
  const dance = edited.activities.find((activity) => activity.kind === "dance");
  assert.equal(dance.end - dance.start, 15);
  assert.equal(dance.requestedBy.memberName, "Riya");
  assert.equal(edited.facts.find((fact) => fact.kind === "dinner_start").value, 1245);
  for (const lang of ["mr", "hi", "en"]) {
    assert.ok(requirementLabel(requirements[0], lang).includes(planTime(1245, lang)));
    assert.ok(approvedRecapText([dance], lang).includes(planTime(dance.end, lang)));
  }
  assert.equal(demoSangeet.activities.find((activity) => activity.kind === "dance").end, 1325);
});
