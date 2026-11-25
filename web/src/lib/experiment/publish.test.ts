import { describe, expect, it } from "vitest";
import type { FlagsmithConfig } from "@flagsmith/nodejs";
import { publishReplay } from "./publish";
import { METRICS } from "./metrics";

type Event = { identifier: string; event: string; value: string; metadata: { experiment_id: number; source: string; scenario: string } };
function intake(bothVariants = true, status = 200) {
  const events: Event[] = [];
  const transport: NonNullable<FlagsmithConfig["fetch"]> = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "events.api.flagsmith.com") {
      events.push(...JSON.parse(String(init?.body)).events);
      return new Response(null, { status });
    }
    expect(url.pathname).toMatch(/\/identities\/$/);
    const { identifier } = JSON.parse(String(init?.body));
    const index = Number(identifier.split(":").at(-1));
    const variant = bothVariants && index % 2 ? "clarify_scope" : "baseline";
    return Response.json({ flags: [{ feature: { id: 7, name: "caller_prompt" }, enabled: true,
      feature_state_value: variant, variant: variant === "baseline" ? "control" : "clarification-treatment",
      metadata: { experiment: { id: 37, name: "caller", in_experiment: true } } }] });
  };
  return { events, transport };
}

describe("caller experiment delivery through the Flagsmith SDK", () => {
  it("joins ten genuine exposures with their numeric outcomes and keeps private input out of the batch", async () => {
    const { events, transport } = intake();
    const run = await publishReplay("fixture-key", "run-19", transport);
    expect(run).toMatchObject({ calls: 10, accepted: 40, experimentId: 37 });
    const ids = new Set(events.map((event) => event.identifier));
    expect(ids.size).toBe(10);
    for (const id of ids) {
      const rows = events.filter((event) => event.identifier === id);
      expect(rows).toHaveLength(4);
      expect(rows.map((row) => row.event)).toEqual(expect.arrayContaining(Object.values(METRICS)));
      expect(["control", "clarification-treatment"]).toContain(rows[0].value);
      expect(rows.every((row) => row.metadata.experiment_id === 37 && row.metadata.source === "scripted_replay")).toBe(true);
    }
    const unresolved = events.filter((event) => event.event === METRICS.confirmed && event.metadata.scenario === "unknown");
    expect(unresolved.map((event) => event.value)).toEqual(["0", "0"]);
    expect(JSON.stringify(events)).not.toMatch(/manager|wedding_id|telegram|transcript/i);
  });
  it("sends nothing when both variants cannot be enrolled", async () => {
    const { events, transport } = intake(false);
    await expect(publishReplay("fixture-key", "run-20", transport)).rejects.toThrow(/both enrolled/);
    expect(events).toEqual([]);
  });
  it("fails when intake rejects the events", async () => {
    const { transport } = intake(true, 403);
    await expect(publishReplay("fixture-key", "run-21", transport)).rejects.toThrow(/acknowledge/);
  });
});
