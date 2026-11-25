import { afterEach, expect, it, vi } from "vitest";

import { fmtMinute } from "@/lib/compiler/compile";
import { POST as recover } from "@/app/api/ops/recover/route";
import { POST as scan } from "@/app/api/calls/incidents/route";
import { POST as replay } from "@/app/api/calls/replay/route";
import { dispatchStoredResult, processCallResult, storeCallResult } from "@/lib/server/calls";
import { approveRevision, planView, respondToRevision, seedDemoPlan } from "@/lib/server/plan";
import { lifecycleAction, vendorRunSheet } from "@/lib/server/lifecycle";
import { db } from "@/lib/server/supabase";

const incident = vi.hoisted(() => ({ paused: true, remoteAvailable: true }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/flags", async (importOriginal) => {
  const flags = await importOriginal<typeof import("@/lib/server/flags")>();
  return {
    ...flags,
    killSwitch: async (name: string, requireRemote = false) => {
      if (requireRemote && !incident.remoteAvailable) throw new Error("Remote flags unavailable");
      return name === "result_processing_paused" && incident.paused;
    },
  };
});
vi.mock("@/lib/server/agent", () => ({ runAgent: async () => ({ status: "skipped" }) }));
vi.mock("@/lib/server/telegram-bot", async (importOriginal) => {
  const telegram = await importOriginal<typeof import("@/lib/server/telegram-bot")>();
  return { ...telegram, sendWithApp: async () => {} };
});

afterEach(() => {
  incident.remoteAvailable = true;
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

  // A prior venue quote gives the couple a proposal they can commit before the call.
  const baselineFacts = checked(await client.from("facts").insert([
    { wedding_id: wedding.id, function_kind: "sangeet", kind: "music_cutoff", value: 1315,
      status: "confirmed", channel: "quote", ref: "fixture-previous-cutoff", wording: "Amplified music stops at 9:55 PM." },
    { wedding_id: wedding.id, function_kind: "sangeet", kind: "makeup_ready", value: 1190,
      status: "confirmed", channel: "quote", ref: "fixture-makeup", wording: "Makeup will be ready at 7:50 PM." },
  ]).select("id,kind"));
  const priorCutoff = baselineFacts.find(({ kind }) => kind === "music_cutoff");
  if (!priorCutoff) throw new Error("Expected a baseline cutoff");
  const initial = await planView(memberA, wedding.id);
  const originalProposal = initial?.result.proposals[0];
  if (!initial || !originalProposal) throw new Error("Expected a proposal before the incident");
  const originalApproval = { weddingId: wedding.id, revision: initial.revision, proposalId: originalProposal.id };
  expect(await approveRevision(memberA, originalApproval)).toMatchObject({ status: "ok" });

  const [before, beforeB] = await Promise.all([planView(memberA, wedding.id), planView(memberB, wedding.id)]);
  if (!before || !beforeB) throw new Error("Expected a plan for both households");
  expect(before).toMatchObject({
    canApprove: true,
    committed: { revision: initial.revision, proposalId: originalProposal.id, approvedBy: "Meera" },
  });
  expect(beforeB).toEqual({ ...before, canApprove: false });
  expect(before.facts.find(({ id }) => id === priorCutoff.id)).toMatchObject({ value: 1315, status: "confirmed" });

  // The provider attempt was already authorized and opened before the incident.
  const providerId = "recovery-fixture-attempt";
  const call = checked(await client.from("calls").insert({
    wedding_id: wedding.id, function_kind: "sangeet", fact_kind: "music_cutoff",
    recipient_role: "venue_owner", recipient_name: "Consenting fixture venue", recipient_phone: "",
    purpose: "Confirm when amplified music must stop at the Sangeet",
    status: "dialing", provider_attempt_id: providerId, language: "English",
    authorized_by: author.id, flags: { channel: "phone" },
  }).select("id").single());

  // Approval applies its moves to the timeline. Make the venue's new cutoff five minutes
  // earlier than the committed dance end so recovery creates a visible conflict.
  const dance = before.activities.find(({ id }) => id === "dance");
  if (!dance) throw new Error("Expected the approved dance on the timeline");
  const cutoff = dance.end - 5;
  const wording = `Amplified music must stop at ${fmtMinute(cutoff)} for the Sangeet.`;
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

  const [afterA, afterB] = await Promise.all([planView(memberA, wedding.id), planView(memberB, wedding.id)]);
  if (!afterA || !afterB) throw new Error("Expected a recovered plan for both households");
  expect(afterB).toEqual({ ...afterA, canApprove: false });
  expect(afterA.revision).toBe(before.revision + 1);
  expect(afterA.committed).toEqual(before.committed);
  expect(await approveRevision(memberA, originalApproval)).toMatchObject({ status: "stale" });
  await expect(approveRevision(memberB, {
    ...originalApproval, revision: afterA.revision,
  })).rejects.toMatchObject({ message: "couple_only", status: 403 });
  const revisions = checked(await client.from("plan_revisions").select("revision,result")
    .eq("wedding_id", wedding.id).order("revision"));
  expect(revisions.map(({ revision }) => revision)).toEqual([initial.revision, before.revision, afterA.revision]);
  expect(revisions.at(-1)?.result).toEqual(afterA.result);
  expect(afterA.result.conflicts).toContainEqual(expect.objectContaining({
    activityId: "dance", constraint: "music_cutoff", overByMin: 5,
  }));
  const completed = checked(await client.from("calls").select("*").eq("wedding_id", wedding.id));
  expect(completed).toHaveLength(1);
  expect(completed[0]).toMatchObject({ id: call.id, provider_attempt_id: providerId, status: "completed", result });
  expect(completed[0].processed_at).not.toBeNull();
  expect(afterA.facts.find(({ id }) => id === completed[0].fact_id)).toMatchObject({
    kind: "music_cutoff", status: "confirmed", value: cutoff, channel: "samvaad_call", wording,
  });
  const eventsInDb = checked(await client.from("events").select("kind").eq("wedding_id", wedding.id)
    .in("kind", ["call_result_stored", "call_result_applied"]));
  expect(eventsInDb.map(({ kind }) => kind).sort()).toEqual(["call_result_applied", "call_result_stored"]);
  expect(external).toEqual([]);
});

it("validates approved inline recovery input and requires a remote switch value", async () => {
  vi.stubEnv("OPS_SECRET", "recovery-fixture-ops");
  vi.stubEnv("CALL_RESULT_PROCESSOR", "inline");
  const post = (body: string, secret = "recovery-fixture-ops") => recover(new Request("http://localhost/api/ops/recover", {
    method: "POST", headers: { "x-ops-secret": secret }, body,
  }));
  expect((await post("{}", "wrong")).status).toBe(403);
  for (const body of ['{"dryrun":true}', '{"dryRun":"false"}', '[]', '{}{}']) {
    expect((await post(body)).status).toBe(400);
  }
  expect((await post(" ".repeat(1025))).status).toBe(413);
  incident.paused = true;
  expect(await (await post('{"dryRun":true}')).json()).toEqual({ dryRun: true, paused: true });
  incident.remoteAvailable = false;
  expect((await post("{}")).status).toBe(503);
  expect((await post('{"dryRun":true}')).status).toBe(503);
});

it("compiles a contacted replacement for both households and records the couple's exact decision", async () => {
  const endpoint = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(endpoint.hostname);
  vi.stubEnv("FLAGSMITH_SERVER_KEY", "");
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== endpoint.origin) throw new Error("Unexpected external request");
    if (url.pathname === "/realtime/v1/api/broadcast") return new Response(null, { status: 204 });
    url.pathname = url.pathname.replace(/^\/rest\/v1(?=\/|$)/, "");
    return realFetch(input instanceof Request ? new Request(url, input) : url, init);
  });

  const client = db();
  const wedding = checked(await client.from("weddings")
    .insert({ partner_a: "Meera", partner_b: "Aarav", stage: "guests" }).select("id").single());
  const households = checked(await client.from("households").insert([
    { wedding_id: wedding.id, side: "A", name: "Household A" },
    { wedding_id: wedding.id, side: "B", name: "Household B" },
  ]).select("id,side"));
  const couple = 1201;
  const parent = 1202;
  checked(await client.from("members").insert([
    { wedding_id: wedding.id, household_id: households.find(({ side }) => side === "A")?.id,
      tg_user_id: couple, display_name: "Meera", is_couple: true, is_parent_delegate: false, role: "couple" },
    { wedding_id: wedding.id, household_id: households.find(({ side }) => side === "B")?.id,
      tg_user_id: parent, display_name: "Arjun", is_couple: false, is_parent_delegate: true, role: "parent" },
  ]).select("id"));

  const old = checked(await client.from("vendors")
    .insert({ wedding_id: wedding.id, name: "Original caterer", category: "caterer",
      status: "accepted", functions: ["sangeet", "ceremony"] }).select("id,view_token").single());
  const cancel = { type: "cancel_vendor", vendorId: old.id, simulated: true };
  await expect(lifecycleAction(parent, wedding.id, cancel)).rejects.toMatchObject({ status: 409, message: "stage_locked:day_of" });
  await lifecycleAction(couple, wedding.id, { type: "advance_stage", expectedStage: "guests" });
  const cancelled = await lifecycleAction(parent, wedding.id, cancel);
  expect(cancelled.tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "incident", owner: "Arjun", seeded: true }),
    expect.objectContaining({ kind: "replacement", owner: "Arjun", seeded: true }),
  ]));
  await expect(vendorRunSheet(old.view_token)).rejects.toMatchObject({ status: 404 });

  const submit = (name: string) => lifecycleAction(couple, wedding.id, { type: "propose_replacement", vendorId: old.id,
    name, contact: "Private contact confirmation", runSheet: "Arrive at 6:00 pm", quoteInr: 20000 });
  const first = await submit("First candidate");
  const firstVendor = first.vendors.find(({ replacesVendorId }) => replacesVendorId === old.id);
  expect(firstVendor).toMatchObject({ status: "shortlisted", viewUrl: null });
  const oldPlan = await planView(couple, wedding.id);
  if (!firstVendor || !oldPlan) throw new Error("Expected a pending replacement");
  const oldDecision = { weddingId: wedding.id, revision: oldPlan.revision, proposalId: oldPlan.result.proposals[0].id };
  await lifecycleAction(couple, wedding.id, { type: "cancel_vendor", vendorId: firstVendor.id });
  await expect(approveRevision(couple, oldDecision)).resolves.toMatchObject({ status: "stale" });

  await seedDemoPlan(couple, wedding.id);
  checked(await client.from("facts").insert([
    { wedding_id: wedding.id, function_kind: "sangeet", kind: "music_cutoff", value: 1315,
      status: "confirmed", channel: "quote", ref: "replacement-fixture-cutoff", wording: "Music stops at 9:55 PM." },
    { wedding_id: wedding.id, function_kind: "sangeet", kind: "makeup_ready", value: 1190,
      status: "confirmed", channel: "quote", ref: "replacement-fixture-makeup", wording: "Makeup will be ready at 7:50 PM." },
  ]).select("id"));
  const schedule = await planView(couple, wedding.id);
  const scheduleProposal = schedule?.result.proposals.find((proposal) => proposal.moves.length);
  if (!schedule || !scheduleProposal) throw new Error("Expected a schedule proposal");
  await expect(approveRevision(couple, { weddingId: wedding.id, revision: schedule.revision, proposalId: scheduleProposal.id }))
    .resolves.toMatchObject({ status: "ok" });
  const originalSchedule = (await planView(parent, wedding.id))?.committed;
  expect(originalSchedule?.recap.moves).not.toHaveLength(0);

  const submitted = await submit("Replacement caterer");
  const replacement = submitted.vendors.find((v) => v.name === "Replacement caterer");
  if (!replacement) throw new Error("Expected pending vendor");
  await expect(submit("Duplicate candidate")).rejects.toMatchObject({ status: 409, message: "replacement_already_proposed" });
  await expect(lifecycleAction(parent, wedding.id, { type: "authorize_vendor", vendorId: replacement.id }))
    .rejects.toMatchObject({ status: 409, message: "approve_replacement_in_plan" });
  const [forCouple, forParent] = await Promise.all([planView(couple, wedding.id), planView(parent, wedding.id)]);
  if (!forCouple || !forParent) throw new Error("Expected a shared replacement plan");
  expect(forParent.revision).toBe(forCouple.revision);
  expect(forParent.result).toEqual(forCouple.result);
  expect(forParent).not.toHaveProperty("replacementQuotes");
  expect(JSON.stringify(forParent)).not.toContain("Private contact confirmation");
  expect(forCouple.replacementQuotes).toEqual({ [replacement.id]: 20000 });
  const proposal = forCouple.result.proposals.find(({ vendorReplacement }) => vendorReplacement?.vendorId === replacement.id);
  if (!proposal) throw new Error("Expected a replacement proposal");
  expect(proposal.vendorReplacement).toMatchObject({ vendorName: replacement.name,
    cancelledVendorId: old.id, functions: ["sangeet", "ceremony"], seeded: true });
  const decision = { weddingId: wedding.id, revision: forCouple.revision, proposalId: proposal.id };
  await expect(respondToRevision(parent, { ...decision, stance: "agree", note: "" })).resolves.toMatchObject({ status: "ok" });
  expect((await planView(couple, wedding.id))?.responses[0]).toMatchObject({ memberName: "Arjun", stance: "agree" });
  await expect(approveRevision(parent, decision)).rejects.toMatchObject({ status: 403 });
  await expect(approveRevision(couple, decision)).resolves.toMatchObject({ status: "ok" });
  const final = await Promise.all([planView(couple, wedding.id), planView(parent, wedding.id)]);
  for (const view of final) {
    expect(view?.replacementApproval).toMatchObject({ revision: decision.revision, proposalId: decision.proposalId,
      approvedBy: "Meera", recap: { vendorReplacement: proposal.vendorReplacement } });
    expect(view?.committed).toEqual(originalSchedule);
  }
  expect(checked(await client.from("weddings").select("committed_revision").eq("id", wedding.id).single())
    .committed_revision).toBe(schedule.revision);

  const approved = checked(await client.from("vendors")
    .select("status,authorized_by,accepted_at,paid_at,committed_inr,view_token").eq("id", replacement.id).single());
  expect(approved).toMatchObject({ status: "authorized", accepted_at: null, paid_at: null, committed_inr: 20000 });
  expect(approved.authorized_by).toBeTruthy();
  const sheet = await vendorRunSheet(approved.view_token);
  expect(sheet.vendor.runSheet).toBe("Arrive at 6:00 pm");
  expect(JSON.stringify(sheet)).not.toContain("Private contact confirmation");
});
