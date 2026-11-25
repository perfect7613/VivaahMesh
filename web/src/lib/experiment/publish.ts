import { Flagsmith } from "@flagsmith/nodejs";
import type { FlagsmithConfig } from "@flagsmith/nodejs";
import { assignment, PROMPT_VERSION, recordExposure, recordOutcome } from "./metrics";
import { SCENARIOS, type Variant } from "./scenarios";
import { runOne } from "./score";

/** Validate the entire paired sample before sending the first exposure. The fixture has no real contacts. */
export async function publishReplay(environmentKey: string, runId: string, transport: NonNullable<FlagsmithConfig["fetch"]> = fetch) {
  if (!environmentKey) throw new Error("Set FLAGSMITH_EXPERIMENT_REPLAY_KEY for a dedicated replay environment.");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(runId)) throw new Error("Pass a unique run ID (1–64 letters, numbers, underscores or hyphens).");
  const eventsOrigin = "https://events.api.flagsmith.com";
  let accepted = 0;
  const client = new Flagsmith({ environmentKey, enableEvents: true, requestTimeoutSeconds: 3,
    eventProcessorConfig: { flushInterval: 0 }, fetch: async (input, init) => {
      const response = await transport(input, init);
      if (response.ok && new URL(input instanceof Request ? input.url : String(input)).origin === eventsOrigin) {
        accepted += JSON.parse(String(init?.body)).events.length;
      }
      return response;
    } });
  try {
    const samples = [];
    let experimentId: number | undefined;
    for (const scenario of SCENARIOS) {
      const variants = new Set<Variant>();
      for (let i = 0; i < 64 && variants.size < 2; i++) {
        const identifier = `replay:${runId}:${scenario.id}:${i}`;
        const flags = await client.getIdentityFlags(identifier, {}, true);
        const prompt = assignment(flags.getFlag("caller_prompt"));
        if (!prompt.experiment || variants.has(prompt.variant)) continue;
        experimentId ??= prompt.experiment.id;
        if (experimentId !== prompt.experiment.id) throw new Error("Experiment changed during the replay. No events sent.");
        variants.add(prompt.variant);
        samples.push({ identifier, prompt, log: runOne(scenario, prompt.variant, PROMPT_VERSION) });
      }
      if (variants.size !== 2) throw new Error("Could not obtain both enrolled, keyed variants. Check experiment rollout and variant keys.");
    }
    for (const { identifier, prompt, log } of samples) {
      recordExposure(client, identifier, prompt, "scripted_replay", log.scenario);
      recordOutcome(client, identifier, prompt, { confirmed: Number(log.confirmed !== null),
        followUps: log.redundantQuestions, unsupported: Number(log.unsupportedChange) }, "scripted_replay", log.scenario);
    }
    await client.close();
    if (accepted !== samples.length * 4) throw new Error("Flagsmith did not acknowledge the full event batch. Inspect ingestion before retrying this run.");
    return { experimentId, calls: samples.length, accepted, logs: samples.map((sample) => sample.log) };
  } finally {
    await client.close();
  }
}
