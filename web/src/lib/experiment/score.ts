import { venueEvidence, venueFollowUpCount } from "../venue-evidence";
import { compile } from "../compiler/compile";
import { demoSangeet } from "../compiler/fixtures/demo-sangeet";
import { DEFAULT_POLICY, type Fact } from "../compiler/types";
import { QUESTIONS, SCENARIOS, type Scenario, type Variant } from "./scenarios";

export interface RunLog {
  scenario: string;
  variant: Variant;
  version: string;
  confirmed: number | null;
  correct: boolean;
  unsupportedChange: boolean;
  unresolved: boolean;
  redundantQuestions: number;
  downstream: string;
}

const fmt = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} pm`;

/** Replays one scenario for one variant through the production evidence extractor and compiler. */
export function runOne(s: Scenario, variant: Variant, version = "v1"): RunLog {
  const questions = [QUESTIONS[variant], ...(s.followUps?.[variant] ?? [])];
  const transcript = questions.flatMap((question, i) => {
    const answer = s.answers[variant][i];
    if (!answer) throw new Error(`Missing scripted answer for ${s.id} (${variant}, question ${i + 1})`);
    return [{ role: "agent" as const, text: question }, { role: "user" as const, text: answer }];
  });
  const facts = venueEvidence({ callId: `exp-${s.id}-${variant}`, functionKind: "sangeet", channel: "samvaad_call", transcript, connected: true, originalTranscript: true, variables: s.variables[variant] });
  const final = facts.at(-1);
  const confirmed = final?.status === "confirmed" ? final.value : null;
  // Downstream schedule: what the compiler would do with this answer on the demo Sangeet.
  const snap = demoSangeet;
  const withFact = { ...snap, facts: [...snap.facts.filter((f) => f.kind !== "music_cutoff"), ...(final ? [{ ...final, id: "exp" } as Fact] : [])] };
  const r = compile(withFact, DEFAULT_POLICY);
  return {
    scenario: s.id,
    variant,
    version,
    confirmed,
    correct: confirmed !== null && confirmed === s.truth,
    unsupportedChange: confirmed !== null && confirmed !== s.truth,
    unresolved: confirmed === null,
    redundantQuestions: venueFollowUpCount({ connected: true, transcript }),
    downstream: confirmed === null ? `blocked (${r.blocking.length})` : `cutoff ${fmt(confirmed)} → ${r.proposals.length} option(s), ${r.conflicts.length} conflict(s)`,
  };
}

export function runAll(version = "v1") {
  const logs = SCENARIOS.flatMap((s) => (["baseline", "clarify_scope"] as Variant[]).map((v) => runOne(s, v, version)));
  const per = (v: Variant) => {
    const l = logs.filter((x) => x.variant === v);
    return { variant: v, runs: l.length, correct: l.filter((x) => x.correct).length, unsupported: l.filter((x) => x.unsupportedChange).length, unresolved: l.filter((x) => x.unresolved).length, redundantQuestions: l.reduce((t, x) => t + x.redundantQuestions, 0), failures: l.filter((x) => !x.correct && !(x.unresolved && SCENARIOS.find((s) => s.id === x.scenario)!.truth === null)).map((x) => x.scenario) };
  };
  return { logs, summary: [per("baseline"), per("clarify_scope")] };
}

export function report(version = "v1") {
  const { logs, summary } = runAll(version);
  return [
    "# Caller-prompt experiment (Flagsmith `caller_prompt`)",
    "",
    "> Demo comparison on 5 scripted scenarios, not a statistical claim. Reproduce: `cd web && npm run experiment`.",
    "",
    "| Variant | Runs | Correct cutoff | Unsupported change | Unresolved | Redundant questions | Failed scenarios |",
    "|---|---|---|---|---|---|---|",
    ...summary.map((s) => `| \`${s.variant}\` | ${s.runs} | ${s.correct} | ${s.unsupported} | ${s.unresolved} | ${s.redundantQuestions} | ${s.failures.join(", ") || "none"} |`),
    "",
    "| Scenario | Variant | Confirmed | Correct | Redundant Qs | Downstream schedule |",
    "|---|---|---|---|---|---|",
    ...logs.map((l) => `| ${l.scenario} | ${l.variant} | ${l.confirmed === null ? "—" : fmt(l.confirmed)} | ${l.correct ? "✓" : l.unresolved ? "open" : "✗"} | ${l.redundantQuestions} | ${l.downstream} |`),
    "",
    "The unknown and lawn-only scenarios have no confirmed whole-event cutoff. Leaving them open is the correct outcome. A whole-event cutoff inferred from the lawn restriction counts as an unsupported change.",
    "",
  ].join("\n");
}
