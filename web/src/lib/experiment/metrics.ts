import { Flag, Flagsmith } from "@flagsmith/nodejs";
import type { BaseFlag } from "@flagsmith/nodejs";
import type { Variant } from "./scenarios";

export interface CallerPrompt {
  variant: Variant;
  version: string;
  experiment?: { id: number; key: string };
}
export const PROMPT_VERSION = "v1";
export const METRICS = {
  confirmed: "caller_facts_confirmed",
  followUps: "caller_follow_up_count",
  unsupported: "caller_unsupported_changes",
} as const;

export function assignment(flag?: BaseFlag): CallerPrompt {
  const value = flag?.value;
  if (!flag?.enabled || (value !== "baseline" && value !== "clarify_scope")) return { variant: "baseline", version: PROMPT_VERSION };
  if (flag instanceof Flag && flag.experiment?.inExperiment && flag.variant) {
    return { variant: value, version: PROMPT_VERSION, experiment: { id: flag.experiment.id, key: flag.variant } };
  }
  return { variant: value, version: PROMPT_VERSION };
}

export interface OutcomeCounts { confirmed: number; followUps: number; unsupported?: number }
export type EventSource = "scripted_replay" | "vendor_call";

function eventMetadata(prompt: CallerPrompt, source: EventSource, scenario?: string) {
  return { experiment_id: prompt.experiment?.id, prompt_version: prompt.version, source, ...(scenario ? { scenario } : {}) };
}

export function recordExposure(client: Flagsmith, identifier: string, prompt: CallerPrompt, source: EventSource, scenario?: string) {
  if (!prompt.experiment) return;
  client.trackExposureEvent("caller_prompt", { identifier, value: prompt.experiment.key, metadata: eventMetadata(prompt, source, scenario) });
}

export function recordOutcome(client: Flagsmith, identifier: string, prompt: CallerPrompt,
  counts: OutcomeCounts,
  source: EventSource, scenario?: string) {
  if (!prompt.experiment) return;
  const metadata = eventMetadata(prompt, source, scenario);
  for (const name of Object.keys(counts) as (keyof typeof counts)[]) {
    const value = counts[name];
    if (value !== undefined) client.trackEvent(METRICS[name], { identifier, value, metadata });
  }
}
