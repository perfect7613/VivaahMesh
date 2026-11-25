import { describe, expect, it } from "vitest";
import { browserEvidence } from "./browser-evidence";

const transcript = [
  { role: "agent", text: "When must the music stop?" },
  { role: "user", text: "संगीत रात दस बजे बंद होना चाहिए।" },
] as const;
const variables = {
  confirmed: "yes",
  cutoff_scope: "sangeet_only",
  music_cutoff: "22:00",
  vendor_wording: transcript[1].text,
};

describe("browser call evidence", () => {
  it("retains the original quote and confirms an explicit, scoped cutoff", () => {
    expect(browserEvidence(variables, transcript)).toEqual(variables);
  });

  it.each([
    { vendor_wording: "" },
    { vendor_wording: transcript[0].text },
    { cutoff_scope: "unknown" },
    { cutoff_scope: undefined },
    { music_cutoff: "10" },
    { music_cutoff: "22:60" },
    { confirmed: "no" },
  ])("keeps incomplete evidence unresolved (%o)", (overrides) => {
    expect(browserEvidence({ ...variables, ...overrides }, transcript)).toMatchObject({
      confirmed: "no",
      music_cutoff: "",
      vendor_wording: transcript[1].text,
    });
  });

  it("cannot confirm a result without a vendor utterance", () => {
    expect(browserEvidence(variables, transcript.slice(0, 1))).toMatchObject({
      confirmed: "no",
      music_cutoff: "",
      vendor_wording: "",
    });
  });
});
