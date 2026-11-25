import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { db } from "./supabase";
import { HttpError } from "./weddings";
import { flagsForMember, recordVendorMetrics } from "./flags";
import { authorizedPrompt } from "./call-preview-token";
import { browserCallDetails, callRecipientScope, callWedding, canUseLiveCalls, requireAuthorizer } from "./calls";
import { findSarvamBrowserInteraction, getSarvamBrowserConfig, getSarvamBrowserSession } from "./sarvam-browser";
import { browserEvidence } from "./browser-evidence";
import { appUrl } from "./telegram-bot";
import { takeVoiceRequest } from "./voice-request";

const TOKEN = /^[\w-]{43}$/;
const INTERACTION = /^\d{8}\/[\w-]{1,128}$/;
const LANGS = { en: "English", hi: "Hindi", mr: "Marathi" };

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function callResponse(action: () => Promise<unknown>) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  try {
    return Response.json(await action(), { headers });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers });
    console.error("Browser call request failed.");
    return Response.json({ error: "browser_call_error" }, { status: 500, headers });
  }
}

export async function browserInvite(tgId: number, input: Record<string, unknown>) {
  if (input.authorize !== true || typeof input.weddingId !== "string") throw new HttpError(400, "authorization_required");
  const me = await requireAuthorizer(tgId, input.weddingId);
  const wedding = await callWedding(me.wedding_id);
  if (!canUseLiveCalls(wedding)) throw new HttpError(409, "browser_mode_disabled");
  const flags = await flagsForMember(me);
  if (!flags.features.voice_channel.enabled || flags.features.voice_channel.value !== "browser") {
    throw new HttpError(409, "browser_mode_disabled");
  }
  getSarvamBrowserConfig();
  const token = randomBytes(32).toString("base64url");
  const url = appUrl(`/call-consent/${token}`);
  const { id, prompt } = await authorizedPrompt(input.previewToken, me, callRecipientScope(true, wedding));
  const { callerPrompt, recipientName, purpose } = browserCallDetails(prompt.variant);
  if (input.recipientName !== recipientName || input.purpose !== purpose || input.callerPrompt !== callerPrompt) {
    throw new HttpError(409, "browser_preview_changed");
  }
  await takeVoiceRequest(me.wedding_id, "browser-invite");
  const { error } = await db().from("calls").insert({
    id, wedding_id: me.wedding_id, function_kind: "sangeet", fact_kind: "music_cutoff",
    recipient_role: "venue_owner", recipient_name: recipientName,
    recipient_phone: "", purpose, authorized_by: me.id, caller_prompt: callerPrompt,
    status: "authorized", flags: { source: flags.source, channel: "browser", caller_prompt: callerPrompt, caller_assignment: prompt, prompt_version: prompt.version },
    browser_reference: randomBytes(32).toString("base64url"),
    browser_consent_hash: hash(token), browser_consent_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  if (error?.code === "23505") throw new HttpError(409, "call_already_authorized");
  if (error) throw error;
  return { callId: id, url };
}

async function tokenCall(token: string) {
  if (!TOKEN.test(token)) throw new HttpError(404, "call_not_found");
  const { data, error } = await db().from("calls")
    .select("id,wedding_id,flags,status,result_received_at,processed_at,recipient_name,language,purpose,function_kind,caller_prompt,browser_consent_expires_at,browser_consented_at,browser_started_at,browser_reference,provider_attempt_id,fact:facts(status)")
    .eq("browser_consent_hash", hash(token)).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "call_not_found");
  const expiry = Date.parse(data.browser_consent_expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new HttpError(410, "consent_expired");
  if (!canUseLiveCalls(await callWedding(data.wedding_id))) throw new HttpError(409, "browser_mode_disabled");
  return data;
}

export async function consentView(token: string) {
  const call = await tokenCall(token);
  const fact = call.fact as unknown as { status?: string } | null;
  const status = !call.browser_consented_at ? "awaiting_consent"
    : fact ? (fact.status === "confirmed" ? "resolved" : "unresolved")
    : call.result_received_at ? "result_saved" : "browser_ready";
  const config = status === "browser_ready" ? getSarvamBrowserConfig() : null;
  return {
    recipientName: call.recipient_name, purpose: call.purpose, functionKind: call.function_kind,
    language: Object.keys(LANGS).find((code) => LANGS[code as keyof typeof LANGS] === call.language) ?? null,
    channel: "browser", status, promptVariant: call.caller_prompt,
    ...(config && { browserConfig: {
      orgId: config.org_id, workspaceId: config.workspace_id, appId: config.app_id, version: config.version, userIdentifier: call.browser_reference ?? call.id,
    } }),
  };
}

export async function consentToVenueCall(token: string, body: Record<string, unknown>) {
  const call = await tokenCall(token);
  if (body.consent !== true || (body.language !== "en" && body.language !== "hi" && body.language !== "mr")) {
    throw new HttpError(400, "consent_required");
  }
  const { data, error } = await db().from("calls").update({
    browser_consented_at: new Date().toISOString(), language: LANGS[body.language],
  }).eq("id", call.id).is("browser_consented_at", null).eq("status", "authorized")
    .gt("browser_consent_expires_at", new Date().toISOString()).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "consent_already_recorded");
  return { status: "browser_ready" };
}

export async function browserSession(token: string, path: string[], requestUrl: string) {
  const call = await tokenCall(token);
  const config = getSarvamBrowserConfig();
  const expected = ["orgs", config.org_id, "workspaces", config.workspace_id, "apps", config.app_id, "url"];
  const query = new URL(requestUrl).searchParams;
  if (path.length !== expected.length || path.some((part, index) => part !== expected[index])
    || query.get("version") !== String(config.version) || query.get("interaction_type") !== "call") {
    throw new HttpError(404, "browser_session_not_found");
  }
  if (!call.browser_consented_at || call.status !== "authorized") throw new HttpError(409, "browser_call_not_authorized");
  const start = new Date().toISOString();
  const { data, error } = await db().from("calls").update({ browser_started_at: start, status: "dialing" })
    .eq("id", call.id).eq("status", "authorized").is("browser_started_at", null)
    .gt("browser_consent_expires_at", start).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "browser_session_already_started");
  try {
    const session = await getSarvamBrowserSession();
    await recordVendorMetrics(call.id, call.flags?.caller_assignment);
    return session;
  } catch {
    const reset = await db().from("calls").update({ browser_started_at: null, status: "authorized" })
      .eq("id", call.id).eq("browser_started_at", start).eq("status", "dialing");
    if (reset.error) throw reset.error;
    throw new HttpError(502, "browser_session_unavailable");
  }
}

export async function saveBrowserResult(token: string, body: Record<string, unknown>) {
  const call = await tokenCall(token);
  const id = body.interactionId;
  if (typeof id !== "string" || !INTERACTION.test(id)) throw new HttpError(400, "invalid_interaction");
  const resultId = `browser:${id}`;
  if (call.provider_attempt_id === resultId) return { callId: call.id, duplicate: true };
  if (call.status !== "dialing" || !call.browser_started_at) throw new HttpError(409, "browser_call_not_started");
  await takeVoiceRequest(call.id, "browser-result");
  const result = await findSarvamBrowserInteraction({
    interactionId: id, reference: call.browser_reference ?? call.id, startedAt: call.browser_started_at,
  });
  if (!result) throw new HttpError(409, "browser_result_pending");

  const variables = browserEvidence(result.variables, result.transcript);
  const { data, error } = await db().from("calls").update({
    provider_attempt_id: resultId, status: "completed", result_received_at: new Date().toISOString(),
    result: { status: "connected", attempt_id: resultId, original_transcript: result.transcript, original_agent_variables: result.variables, final_agent_variables: variables },
  }).eq("id", call.id).eq("status", "dialing").is("result", null).select("id").maybeSingle();
  if (error) throw error;
  if (!data && (await tokenCall(token)).provider_attempt_id !== resultId) throw new HttpError(409, "browser_result_mismatch");
  return { callId: call.id, duplicate: !data };
}
