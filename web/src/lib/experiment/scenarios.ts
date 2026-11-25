/**
 * Issue #9: five scripted venue-call scenarios. For each `caller_prompt` variant the venue owner's
 * scripted answer is what a real owner plausibly says to THAT question. Scoring lives in code
 * (score.ts), outside any editable prompt.
 */
export type Variant = "baseline" | "clarify_scope";
export interface Scenario {
  id: string;
  description: string;
  /** The true cutoff, minutes after midnight (null = no confirmed cutoff for the whole function). */
  truth: number | null;
  answers: Record<Variant, string[]>;
  /** Subsequent questions asked in each recorded script. Unrequested vendor replies stay unused. */
  followUps?: Partial<Record<Variant, string[]>>;
  /** What the Samvaad agent extracts into its output variables after that conversation. */
  variables: Record<Variant, Record<string, string>>;
}

export const QUESTIONS: Record<Variant, string> = {
  baseline: "By what time must amplified music stop at the Sangeet?",
  clarify_scope: "For the Sangeet evening, the cousins' 20-minute dance is planned near the end. By what time must amplified music stop, and does that apply to the whole event?",
};

export const SCENARIOS: Scenario[] = [
  { id: "clear", description: "Owner knows the rule", truth: 1320, answers: {
    baseline: ["Music must stop by 10 pm."],
    clarify_scope: ["Amplified music must stop by 10 pm, for the whole event."],
  }, variables: { baseline: { cutoff_wording: "Music must stop by 10 pm." }, clarify_scope: { cutoff_wording: "Amplified music must stop by 10 pm, for the whole event.", cutoff_scope: "whole_event", cutoff_function: "sangeet" } } },
  { id: "correction", description: "Owner corrects themselves mid-call", truth: 1350, answers: {
    baseline: ["Music till 10… actually, make it 10:30 pm."],
    clarify_scope: ["Music till 10… actually, make it 10:30 pm for the whole Sangeet."],
  }, variables: { baseline: { cutoff_wording: "Music till 10… actually, make it 10:30 pm." }, clarify_scope: { cutoff_wording: "Music till 10… actually, make it 10:30 pm for the whole Sangeet.", cutoff_scope: "whole_event", cutoff_function: "sangeet" } } },
  { id: "scope", description: "Rule is about the lawn speakers, not the whole event", truth: null, followUps: { baseline: ["Could you confirm the exact time?"] }, answers: {
    baseline: ["The speakers on the lawn go off at 10.", "Yes, 10 pm."],
    clarify_scope: ["Only the lawn speakers stop at 10 pm. I cannot confirm a cutoff for the hall."],
  }, variables: { baseline: { cutoff_wording: "Yes, 10 pm.", cutoff_scope: "amplified_music" }, clarify_scope: { cutoff_wording: "Only the lawn speakers stop at 10 pm. I cannot confirm a cutoff for the hall.", cutoff_scope: "lawn_only", cutoff_function: "sangeet" } } },
  { id: "unknown", description: "Owner doesn't know", truth: null, answers: {
    baseline: ["I'm not sure, you'll have to ask the manager."],
    clarify_scope: ["I don't know, the manager decides that."],
  }, variables: { baseline: { cutoff_status: "unresolved" }, clarify_scope: { cutoff_status: "unresolved" } } },
  { id: "vague", description: "Owner gives a range first", truth: 1350, followUps: { baseline: ["Could you confirm the exact time?"] }, answers: {
    baseline: ["Around 10 or 10:30, depends on the police.", "Probably 10:30."],
    clarify_scope: ["Amplified music must stop at 10:30 pm, whole event, confirmed."],
  }, variables: { baseline: { cutoff_wording: "Probably 10:30.", cutoff_scope: "amplified_music" }, clarify_scope: { cutoff_wording: "Amplified music must stop at 10:30 pm, whole event, confirmed.", cutoff_scope: "whole_event", cutoff_function: "sangeet" } } },
];
