import { afterEach, expect, it, vi } from "vitest";

import { POST as scan } from "@/app/api/calls/incidents/route";
import { POST as replay } from "@/app/api/calls/replay/route";
import { dispatchStoredResult, processCallResult, storeCallResult } from "@/lib/server/calls";
import { planView, seedDemoPlan } from "@/lib/server/plan";
import { db } from "@/lib/server/supabase";

const incident = vi.hoisted(() => ({ paused: true }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/flags", async (importOriginal) => {
  const flags = await importOriginal<typeof import("@/lib/server/flags")>();
  return {
    ...flags,
    killSwitch: async (name: string) => name === "result_processing_paused" && incident.paused,
  };
});
vi.mock("@/lib/server/agent", () => ({ runAgent: async () => ({ status: "skipped" }) }));
vi.mock("@/lib/server/telegram-bot", async (importOriginal) => {
  const telegram = await importOriginal<typeof import("@/lib/server/telegram-bot")>();
  return { ...telegram, sendWithApp: async () => {} };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function checked<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("Expected a database result");
  return data;
}

it("replays stored evidence across concurrent ops requests and updates both household plans once", async () => {
  const endpoint = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(endpoint.hostname);
  const hook = "https://nudgebee.fixture.invalid/webhook";
  vi.stubEnv("NUDGEBEE_EVENT_WEBHOOK_URL", hook);
  vi.stubEnv("CALL_RESULT_PROCESSOR", "worker");
  vi.stubEnv("OPS_SECRET", "recovery-fixture-ops");
  vi.stubEnv("FLAGSMITH_SERVER_KEY", "");
  vi.stubEnv("DEMO_REHEARSAL_CALLS", "0");

  const realFetch = globalThis.fetch;
  const external: string[] = [];
  const events: unknown[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin === endpoint.origin) {
      // Standalone PostgREST serves the same API without Supabase's gateway prefix.
      url.pathname = url.pathname.replace(/^\/rest\/v1(?=\/|$)/, "");
      return realFetch(input instanceof Request ? new Request(url, input) : url, init);
    }
    if (url.href === hook && init?.method === "POST") {
      events.push(JSON.parse(String(init.body)));
      return Response.json({ accepted: true });
    }
    external.push(url.origin);
    throw new Error("Unexpected external request");
  });

  const client = db();
  const wedding = checked(await client.from("weddings")
    .insert({ partner_a: "Meera", partner_b: "Aarav" }).select("id").single());
  const households = checked(await client.from("households").insert([
    { wedding_id: wedding.id, side: "A", name: "Household A" },
    { wedding_id: wedding.id, side: "B", name: "Household B" },
  ]).select("id,side"));
  const memberA = 101;
  const memberB = 102;
  const members = checked(await client.from("members").insert([
    { wedding_id: wedding.id, household_id: households.find(({ side }) => side === "A")?.id,
      tg_user_id: memberA, display_name: "Meera", is_couple: true, role: "couple", language: "mr" },
    { wedding_id: wedding.id, household_id: households.find(({ side }) => side === "B")?.id,
      tg_user_id: memberB, display_name: "Arjun", is_couple: false, role: "parent", language: "hi" },
  ]).select("id,tg_user_id"));
  const author = members.find(({ tg_user_id }) => tg_user_id === memberA);
  if (!author) throw new Error("Missing seeded call authorizer");
  await seedDemoPlan(memberA, wedding.id);

  const before = await planView(memberA, wedding.id);
  expect(before).not.toBeNull();
  expect(await planView(memberB, wedding.id)).toEqual(before);
  expect(before?.facts.find(({ kind }) => kind === "music_cutoff")?.status).toBe("unresolved");

  // The provider attempt was already authorized and opened before the incident.
  const providerId = "recovery-fixture-attempt";
  const call = checked(await client.from("calls").insert({
    wedding_id: wedding.id, function_kind: "sangeet", fact_kind: "music_cutoff",
    recipient_role: "venue_owner", recipient_name: "Consenting fixture venue", recipient_phone: "",
    purpose: "Confirm when amplified music must stop at the Sangeet",
    status: "dialing", provider_attempt_id: providerId, language: "English",
    authorized_by: author.id, flags: { channel: "phone" },
  }).select("id").single());

  const wording = "Amplified music must stop at 10 PM for the Sangeet.";
  const payload = {
    attempt_id: providerId,
    status: "connected",
    original_transcript: [
      { role: "agent", text: "When must amplified music stop for the Sangeet?" },
      { role: "user", text: wording },
    ],
    final_agent_variables: { cutoff_status: "confirmed", cutoff_scope: "amplified_music", cutoff_wording: wording },
  } as const;
  const result = { ...payload, original_transcript: [...payload.original_transcript] };

  const duplicates = await Promise.all([storeCallResult(call.id, result), storeCallResult(call.id, result)]);
  expect(duplicates.map(({ duplicate }) => duplicate).sort()).toEqual([false, true]);
  const firstReceipt = duplicates.find(({ duplicate }) => !duplicate)?.call.result_received_at;
  expect(firstReceipt).toBeTruthy();
  expect((await storeCallResult(call.id, { ...result, failure_reason: "Late duplicate" })).duplicate).toBe(true);
  expect(await dispatchStoredResult(call.id)).toBe("paused");
  expect(await dispatchStoredResult(call.id)).toBe("paused");
  expect(events).toHaveLength(2);
  for (const event of events) {
    expect(event).toMatchObject({
      event: { finding_id: providerId, status: "FIRING", labels: { call_id: call.id, reason: "paused" } },
    });
  }

  function request(secret = "recovery-fixture-ops") {
    return new Request("http://localhost/api/calls/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ops-secret": secret },
      body: JSON.stringify({ callId: call.id }),
    });
  }

  expect((await replay(request("wrong-secret"))).status).toBe(403);
  const paused = await replay(request());
  expect(paused.status).toBe(409);
  expect((await paused.json()).results).toEqual({ [call.id]: "paused" });
  expect(await planView(memberA, wedding.id)).toEqual(before);
  const stored = checked(await client.from("calls").select("*").eq("id", call.id).single());
  expect(stored).toMatchObject({ status: "completed", result, result_received_at: firstReceipt, processed_at: null, fact_id: null });

  incident.paused = false;
  expect(await dispatchStoredResult(call.id)).toBe("queued");
  const scanRequest = () => new Request("http://localhost/api/calls/incidents", {
    method: "POST",
    headers: { "x-ops-secret": "recovery-fixture-ops" },
  });
  expect((await (await scan(scanRequest())).json()).reported).toBe(0);

  const claim = async () => {
    const { data, error } = await client.rpc("claim_next_call_result");
    if (error) throw error;
    return data;
  };
  // Only one worker can claim the result. Simulate it stopping after the lease.
  const claims = await Promise.all([claim(), claim()]);
  expect(claims.filter(Boolean)).toEqual([call.id]);
  expect(await claim()).toBeNull();

  // Advance the recorded times instead of sleeping through the worker and scan leases.
  const old = new Date(Date.now() - 6 * 60_000).toISOString();
  const { error: ageError } = await client.from("calls").update({
    result_received_at: old, incident_attempted_at: old, process_attempted_at: old,
  }).eq("id", call.id);
  if (ageError) throw ageError;
  const scans = await Promise.all([scan(scanRequest()), scan(scanRequest())]);
  expect(scans.map(({ status }) => status)).toEqual([200, 200]);
  const scanCounts = await Promise.all(scans.map(async (response) => (await response.json()).reported));
  expect(scanCounts.sort()).toEqual([0, 1]);
  expect(events).toHaveLength(3);
  expect(events[2]).toMatchObject({
    event: { finding_id: providerId, status: "FIRING", labels: { call_id: call.id, reason: "overdue" } },
  });

  // A replacement worker and an ops replay can process the same result at once.
  expect(await claim()).toBe(call.id);
  const [response, workerOutcome] = await Promise.all([replay(request()), processCallResult(call.id)]);
  expect(response.status).toBe(200);
  expect([(await response.json()).results[call.id], workerOutcome].sort()).toEqual(["already", "applied"]);
  expect(await claim()).toBeNull();
  expect((await (await replay(request())).json()).results).toEqual({ [call.id]: "already" });

  const afterA = await planView(memberA, wedding.id);
  const afterB = await planView(memberB, wedding.id);
  expect(afterA).toEqual(afterB);
  expect(afterA?.snapshotRevision).toBe((before?.snapshotRevision ?? 0) + 1);
  expect(afterA?.result.conflicts).toContainEqual(expect.objectContaining({
    activityId: "dance", constraint: "music_cutoff", overByMin: 5,
  }));
  const completed = checked(await client.from("calls").select("*").eq("wedding_id", wedding.id));
  expect(completed).toHaveLength(1);
  expect(completed[0]).toMatchObject({ id: call.id, provider_attempt_id: providerId, status: "completed", result });
  expect(completed[0].processed_at).not.toBeNull();
  expect(afterA?.facts.find(({ id }) => id === completed[0].fact_id)).toMatchObject({
    kind: "music_cutoff", status: "confirmed", value: 1320, channel: "samvaad_call", wording,
  });
  const eventsInDb = checked(await client.from("events").select("kind").eq("wedding_id", wedding.id)
    .in("kind", ["call_result_stored", "call_result_applied"]));
  expect(eventsInDb.map(({ kind }) => kind).sort()).toEqual(["call_result_applied", "call_result_stored"]);
  expect(external).toEqual([]);
});
