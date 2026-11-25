import assert from "node:assert/strict";
import { test } from "vitest";
import { clockMinutes, venueEvidence, venueFollowUpCount } from "../src/lib/venue-evidence.ts";

const user = (text) => ({ role: "user", text });
const agent = (text) => ({ role: "agent", text });
const base = {
  callId: "call-1",
  functionKind: "sangeet",
  functionDate: "2026-12-08",
  channel: "samvaad_call",
  transcript: [],
  variables: { cutoff_scope: "amplified_music" },
  connected: true,
  originalTranscript: true,
};

function evidence(transcript, cutoff_wording, variables = {}, input = {}) {
  return venueEvidence({ ...base, ...input, transcript, variables: { ...base.variables, cutoff_wording, ...variables } });
}

test("preserves both parts of a same-turn correction to a cutoff", () => {
  const facts = evidence([user("The amplified music cutoff is 9:30 pm … actually make it 10")], "actually make it 10");
  assert.deepEqual(facts, [
    {
      id: "venue:call-1:1", kind: "music_cutoff", functionKind: "sangeet", status: "confirmed", value: 1290,
      source: { channel: "samvaad_call", ref: "call-1", wording: "The amplified music cutoff is 9:30 pm …" },
    },
    {
      id: "venue:call-1", kind: "music_cutoff", functionKind: "sangeet", status: "confirmed", value: 1320,
      source: { channel: "samvaad_call", ref: "call-1", wording: "actually make it 10" }, supersedes: "venue:call-1:1",
    },
  ]);
});

test("carries the period from a scoped question through corrections without overwriting source wording", () => {
  const facts = evidence([
    agent("What time must amplified music stop for the Sangeet this evening?"),
    user("9:30"),
    agent("Is that the cutoff for the Sangeet?"),
    user("Actually make it 10"),
    user("I mean 10:15"),
  ], "Actually make it 10");
  assert.deepEqual(facts.map(({ value, source, supersedes }) => [value, source.wording, supersedes]), [
    [1290, "9:30", undefined],
    [1320, "Actually make it 10", "venue:call-1:1"],
    [1335, "I mean 10:15", "venue:call-1:2"],
  ]);
});

test("a later uncertain, relative, or declined correction supersedes an earlier usable time", () => {
  for (const correction of ["Actually maybe 10 pm", "Actually make it 10 minutes later", "Actually I can't confirm that"]) {
    const facts = evidence([user("9:30 pm"), user(correction)], "9:30 pm");
    assert.equal(facts[0].value, 1290);
    assert.equal(facts[1].status, "unresolved");
    assert.equal(facts[1].source.wording, correction);
    assert.equal(facts[1].supersedes, facts[0].id);
  }
});

test("leaves missing periods, unverified wording, no answer, and declared refusals unresolved", () => {
  const word = user("9:30 ... actually make it 10");
  assert.ok(evidence([word], "9:30").every(({ value }) => value === null));
  assert.equal(evidence([user("9:30 pm")], "10:00 pm")[0].status, "unresolved");
  assert.equal(evidence([agent("The cutoff is 10 pm")], "The cutoff is 10 pm")[0].status, "unresolved");
  assert.equal(evidence([word], "9:30", {}, { connected: false })[0].source.wording, "");
  assert.equal(evidence([user("9:30 pm")], "9:30 pm", {}, { originalTranscript: false })[0].source.wording, "");
  assert.equal(evidence([user("9:30 pm")], "9:30 pm", { cutoff_status: "declined" })[0].status, "unresolved");
  assert.equal(evidence([user("I am sure the cutoff is 10")], "the cutoff is 10")[0].status, "unresolved");
});

test("requires a whole-event term to cover this function and rejects an explicit different function or date", () => {
  const time = user("The whole event ends at 10 pm");
  assert.equal(evidence([time], time.text, { cutoff_scope: "whole_event" })[0].status, "unresolved");
  assert.equal(evidence([time], time.text, { cutoff_scope: "whole_event", cutoff_function: "sangeet" })[0].value, 1320);
  const named = user("The whole Sangeet ends at 10 pm");
  assert.equal(evidence([named], named.text, { cutoff_scope: "whole_function" })[0].value, 1320);
  const other = user("The music at the Reception stops at 10 pm");
  assert.equal(evidence([other], other.text)[0].status, "unresolved");
  assert.equal(evidence([time], time.text, { cutoff_function: "ceremony" })[0].status, "unresolved");
  assert.equal(evidence([time], time.text, { cutoff_date: "2026-12-09" })[0].status, "unresolved");
  assert.equal(evidence([time], time.text, { cutoff_scope: "unclear" })[0].status, "unresolved");
});

test("preserves Marathi wording and supports explicit hours in digits and speech", () => {
  const wording = "मोठ्या आवाजात संगीत रात्री दहा वाजता थांबवा.";
  const fact = evidence([user(wording)], wording)[0];
  assert.equal(fact.value, 1320);
  assert.equal(fact.source.wording, wording);
  assert.equal(clockMinutes("संध्याकाळी ०९:३० वाजता"), 1290);
  assert.equal(clockMinutes("22:00"), 1320);
  assert.equal(clockMinutes("10:12am"), 612);
  assert.equal(clockMinutes("10 am in the evening"), null);
  assert.equal(clockMinutes("within 10 minutes"), null);
  assert.equal(clockMinutes("10:99 pm"), null);
});

test("keeps a cutoff after a separate unrelated question and counts cutoff follow-ups", () => {
  const transcript = [
    agent("Can I speak with the manager?"), user("Yes."),
    agent("When does the amplified music need to stop?"), user("9:30 pm"),
    agent("Does that apply to the whole event?"), user("Only amplified music."),
    agent("Could you confirm the time?"), user("9:30 pm"),
    agent("What time is dinner?"), user("I don't know."),
  ];
  assert.equal(venueFollowUpCount({ transcript, connected: true }), 2);
  assert.equal(venueFollowUpCount({ transcript, connected: false }), 0);
  assert.equal(evidence(transcript, "9:30 pm").at(-1).value, 1290);
});
