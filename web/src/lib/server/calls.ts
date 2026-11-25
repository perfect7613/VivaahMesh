import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./supabase";
import { flagsForMember, killSwitch } from "./flags";
import { HttpError, logEvent, memberships } from "./weddings";
import { appUrl, escapeHtml, sendWithApp } from "./telegram-bot";
import { runAgent } from "./agent";
import { reportEvent, resolveEvent } from "./nudgebee";
import { base, pickLang, type BaseLang } from "@/lib/i18n";
import { localized } from "./translate";
import { venueEvidence, venueFollowUpCount } from "@/lib/venue-evidence";
import { fetchSarvamTranscript } from "./sarvam-browser";
type TranscriptTurn = Awaited<ReturnType<typeof fetchSarvamTranscript>>[number];

/**
 * Vendor calls (issue #6). The flow, and the rules no flag can change:
 *  1. A parent or the couple sees WHO will be called and WHY, and taps Authorize.
 *  2. Flagsmith `outbound_dialing_enabled` must be on, or the call is refused and logged.
 *  3. Sarvam Samvaad dials the vendor with a narrow question (variant pinned from `caller_prompt`).
 *  4. The webhook result is stored verbatim first. Then, unless `result_processing_paused` is on,
 *     it becomes a fact and the plan recompiles on every phone. A paused result is replayed later
 *     (NudgeBee runbook) exactly once.
 */

export interface VendorContact {
  role: "venue_owner";
  name: string;
  phone: string;
  language: string;
}

/** Demo vendor: a consenting teammate's phone, configured server-side and never sent whole to clients. */
/** Rehearsal mode: no Sarvam number yet, so the venue's answer is simulated and labelled as such everywhere. */
export const rehearsal = () => process.env.DEMO_REHEARSAL_CALLS === "1";

export function demoVenue(): VendorContact | null {
  const phone = process.env.DEMO_VENUE_PHONE;
  if (!phone) return null;
  return {
    role: "venue_owner",
    name: process.env.DEMO_VENUE_NAME || "Venue owner (demo)",
    phone,
    language: process.env.DEMO_VENUE_LANGUAGE || "Hindi",
  };
}

export const maskPhone = (p: string) => p.replace(/\d(?=\d{4})/g, "•");

function sarvamConfig() {
  const c = {
    key: process.env.SARVAM_VOICE_API_KEY,
    org: process.env.SARVAM_ORG_ID,
    workspace: process.env.SARVAM_WORKSPACE_ID,
    app: process.env.SARVAM_APP_ID,
    version: Number(process.env.SARVAM_APP_VERSION || "1"),
    connection: process.env.SARVAM_CONNECTION_ID,
    agentPhone: process.env.SARVAM_AGENT_PHONE,
  };
  return c.key && c.org && c.workspace && c.app && c.connection && c.agentPhone ? c : null;
}

const secret = () => process.env.CALLS_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET || "";
export const callToken = (callId: string) => createHmac("sha256", secret()).update(`call:${callId}`).digest("hex");
export function verifyCallToken(callId: string, token: string) {
  const want = Buffer.from(callToken(callId));
  const got = Buffer.from(token);
  return secret().length > 0 && want.length === got.length && timingSafeEqual(want, got);
}

const QUESTION: Record<string, (fn: string) => string> = {
  // Baseline: ask only for the cutoff.
  baseline: (fn) => `By what time must amplified music stop at the ${fn}?`,
  // Candidate: name the affected activity so the owner answers for the right part of the evening.
  clarify_scope: (fn) => `For the ${fn} evening, the cousins' 20-minute dance is planned near the end. By what time must amplified music stop, and does that apply to the whole event?`,
};

export function browserCallDetails(prompt: string | null | undefined) {
  const callerPrompt = prompt === "clarify_scope" ? "clarify_scope" : "baseline";
  return {
    callerPrompt,
    recipientName: process.env.DEMO_VENUE_NAME?.trim() || "Venue owner",
    purpose: QUESTION[callerPrompt]("Sangeet"),
  };
}

export async function requireAuthorizer(tgUserId: number, weddingId?: string) {
  const me = (await memberships(tgUserId)).find((m) => !weddingId || m.wedding_id === weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  if (!me.is_couple && me.role !== "parent") throw new HttpError(403, "parents_or_couple_only");
  return me;
}

/** What the family sees before authorizing: recipient, purpose, and whether dialing is allowed. */
export async function callPreview(tgUserId: number, weddingId?: string) {
  const me = await requireAuthorizer(tgUserId, weddingId);
  const venue = demoVenue();
  const flags = await flagsForMember(me);
  const variant = flags.features.caller_prompt.value || "baseline";
  const browserEnabled = flags.features.voice_channel.enabled && flags.features.voice_channel.value === "browser";
  const last = await db()
    .from("calls")
    .select("id, status, created_at, error, processed_at, recipient_name, follow_up_count, fact:facts(status,value,wording)")
    .eq("wedding_id", me.wedding_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const browser = browserEnabled ? browserCallDetails(variant) : null;
  return {
    browserRecipient: browser?.recipientName,
    recipient: venue
      ? { name: venue.name, phone: maskPhone(venue.phone), language: venue.language, role: venue.role }
      : rehearsal()
        ? { name: "Shubh Mangal Lawns (rehearsal)", phone: "no phone call", language: "Hindi", role: "venue_owner" }
        : null,
    purpose: browser?.purpose ?? (QUESTION[variant] ?? QUESTION.baseline)("Sangeet"),
    callerPrompt: browser?.callerPrompt ?? variant,
    dialingEnabled: await killSwitch("outbound_dialing_enabled"),
    browserEnabled,
    configured: (!!sarvamConfig() && !!venue) || rehearsal(),
    rehearsal: !sarvamConfig() && rehearsal(),
    lastCall: last.data,
  };
}

export async function authorizeCall(tgUserId: number, weddingId?: string) {
  const me = await requireAuthorizer(tgUserId, weddingId);
  const cfg = sarvamConfig();
  const isRehearsal = !cfg && rehearsal();
  const venue = isRehearsal ? { role: "venue_owner" as const, name: "Shubh Mangal Lawns (rehearsal)", phone: "rehearsal", language: "Hindi" } : demoVenue();
  if (!venue || (!cfg && !isRehearsal)) throw new HttpError(503, "calling_not_configured");

  const flags = await flagsForMember(me);
  if (flags.features.voice_channel.enabled && flags.features.voice_channel.value === "browser") {
    throw new HttpError(409, "browser_mode_active");
  }
  const variant = flags.features.caller_prompt.value || "baseline";
  const dialing = await killSwitch("outbound_dialing_enabled");
  const s = db();

  const { data: wedding } = await s.from("weddings").select("partner_a, partner_b").eq("id", me.wedding_id).single();
  const { data: call, error } = await s
    .from("calls")
    .insert({
      wedding_id: me.wedding_id,
      function_kind: "sangeet",
      fact_kind: "music_cutoff",
      recipient_role: venue.role,
      recipient_name: venue.name,
      recipient_phone: venue.phone,
      purpose: (QUESTION[variant] ?? QUESTION.baseline)("Sangeet"),
      language: venue.language,
      authorized_by: me.id,
      caller_prompt: variant,
      flags: { caller_prompt: variant, outbound_dialing_enabled: dialing, source: flags.source, policy: flags.policy.version, channel: isRehearsal ? "rehearsal" : "phone" },
      status: dialing ? "dialing" : "blocked",
      error: dialing ? null : "outbound_dialing_disabled",
    })
    .select("*")
    .single();
  if (error) throw error;

  if (!dialing) {
    await logEvent(me.wedding_id, me.id, "call_blocked", { call_id: call.id, reason: "outbound_dialing_enabled=off" });
    return call;
  }

  if (isRehearsal) {
    const { data: updated } = await s.from("calls").update({ provider_attempt_id: `rehearsal-${call.id}` }).eq("id", call.id).select("*").single();
    await logEvent(me.wedding_id, me.id, "call_dialing", { call_id: call.id, caller_prompt: variant, channel: "rehearsal" });
    return { ...(updated ?? call), rehearsal: true };
  }

  const res = await fetch(`https://apps.sarvam.ai/api/outbounds/v1/orgs/${cfg!.org}/workspaces/${cfg!.workspace}/outbounds`, {
    method: "POST",
    headers: { "X-API-Key": cfg!.key!, "content-type": "application/json" },
    body: JSON.stringify({
      app_config: {
        app_id: cfg!.app,
        app_version: cfg!.version,
        connection_config: { connection_id: cfg!.connection, agent_phone_number: cfg!.agentPhone },
        agent_variables: {
          couple_names: `${wedding?.partner_a ?? ""} & ${wedding?.partner_b ?? ""}`,
          function_name: "Sangeet",
          question: call.purpose,
          caller_prompt: variant,
        },
        app_overrides: { initial_language_name: venue.language },
      },
      user_config: { user_phone_number: venue.phone },
      webhook_config: {
        url: `${appUrl("/api/sarvam/webhook")}?call=${call.id}&token=${callToken(call.id)}`,
        metadata: { call_id: call.id, wedding_id: me.wedding_id },
      },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { attempt_id?: string; detail?: unknown };
  const update = res.ok && body.attempt_id
    ? { provider_attempt_id: body.attempt_id }
    : { status: "failed", error: `sarvam ${res.status}: ${JSON.stringify(body.detail ?? body).slice(0, 300)}` };
  const { data: updated } = await s.from("calls").update(update).eq("id", call.id).select("*").single();
  await logEvent(me.wedding_id, me.id, res.ok ? "call_dialing" : "call_failed", { call_id: call.id, caller_prompt: variant, attempt_id: body.attempt_id });
  return updated ?? call;
}

interface SarvamWebhook {
  attempt_id?: string;
  interaction_id?: string;
  original_transcript?: TranscriptTurn[];
  status?: "connected" | "no_answer" | "busy" | "failed";
  final_agent_variables?: Record<string, unknown>;
  original_agent_variables?: Record<string, unknown>;
  interaction_transcript?: { role: "agent" | "user"; en_text: string }[];
  failure_reason?: string;
}

/** Step 1 of the result path: persist verbatim, idempotently. Processing is a separate step. */
export async function storeCallResult(callId: string, payload: SarvamWebhook) {
  const s = db();
  const { data: call } = await s.from("calls").select("*").eq("id", callId).maybeSingle();
  if (!call) throw new HttpError(404, "unknown_call");
  if (typeof payload.attempt_id !== "string" || !payload.attempt_id ||
    (call.provider_attempt_id && call.provider_attempt_id !== payload.attempt_id) ||
    !["connected", "no_answer", "busy", "failed"].includes(payload.status ?? "")) {
    throw new HttpError(409, "call_result_mismatch");
  }
  if (call.result) return { call, duplicate: true };
  if (call.status !== "dialing" && call.status !== "failed") throw new HttpError(409, "call_not_authorized");
  const status = payload.status === "connected" ? "completed" : payload.status === "no_answer" || payload.status === "busy" ? "no_answer" : "failed";
  const { data: stored, error } = await s
    .from("calls")
    .update({ result: payload, result_received_at: new Date().toISOString(), status, error: payload.failure_reason ?? null, provider_attempt_id: call.provider_attempt_id ?? payload.attempt_id ?? null })
    .eq("id", callId)
    .is("result", null)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!stored) return { call, duplicate: true };
  await logEvent(call.wedding_id, null, "call_result_stored", { call_id: callId, status });
  return { call: stored, duplicate: !!call.result };
}

/** Apply the original vendor turns and preserve the chain of corrections. */
/** One NudgeBee incident per stuck result: finding_id is the provider attempt, so duplicate callbacks update it. */
async function reportStuck(callId: string, why: string) {
  const { data: c } = await db().from("calls").select("id, wedding_id, provider_attempt_id, recipient_name, result_received_at, flags").eq("id", callId).maybeSingle();
  if (!c) return;
  const eventId = await reportEvent({
    findingId: `vivaahmesh-call:${c.provider_attempt_id ?? c.id}`,
    aggregationKey: "vivaahmesh_call_result_stuck",
    title: `Venue call answer saved but not applied (${c.recipient_name})`,
    description:
      `A Sarvam venue call finished and its answer is stored, but the families' plan has not been updated. Reason: ${why}. ` +
      "Recovery (needs approval): turn Flagsmith flag result_processing_paused off, then POST /api/ops/recover. Recovery never dials anyone.",
    evidence: `call_id=${c.id}
attempt_id=${c.provider_attempt_id}
wedding_id=${c.wedding_id}
result_received_at=${c.result_received_at}`,
    priority: "HIGH",
    subject: "vivaahmesh-result-worker",
    labels: { call_id: c.id, reason: why.slice(0, 60) },
  });
  if (eventId) await db().from("calls").update({ flags: { ...(c.flags as object), nudgebee_event_id: eventId } }).eq("id", c.id);
}

export async function processCallResult(callId: string): Promise<"applied" | "paused" | "already" | "no_result"> {
  if (await killSwitch("result_processing_paused")) {
    await reportStuck(callId, "result_processing_paused is on");
    return "paused";
  }
  try {
    const out = await applyCallResult(callId);
    if (out === "applied") {
      const { data: c } = await db().from("calls").select("flags").eq("id", callId).maybeSingle();
      const eventId = (c?.flags as { nudgebee_event_id?: string } | null)?.nudgebee_event_id;
      if (eventId) await resolveEvent(eventId);
    }
    return out;
  } catch (e) {
    await reportStuck(callId, `processing failed: ${(e as Error).message}`);
    throw e;
  }
}

async function applyCallResult(callId: string): Promise<"applied" | "already" | "no_result"> {
  const s = db();
  const { data: call, error } = await s.from("calls").select("*").eq("id", callId).maybeSingle();
  if (error) throw error;
  if (!call?.result) return "no_result";
  if (call.processed_at) return "already";

  const payload = call.result as SarvamWebhook;
  const connected = payload.status === "connected";
  const english = /^(?:en|english)$/i.test(call.language);
  const fromAnalytics = connected && !payload.original_transcript && typeof payload.interaction_id === "string";
  const transcript = !connected ? [] : payload.original_transcript
    ?? (fromAnalytics ? await fetchSarvamTranscript(payload.interaction_id!) :
      (payload.interaction_transcript ?? []).map((turn) => ({ role: turn.role, text: turn.en_text })));
  const browser = call.flags?.channel === "browser";
  const variables = (browser ? payload.original_agent_variables : undefined) ?? payload.final_agent_variables ?? {};
  let functionDate: string | null = null;
  if (connected && variables.cutoff_date != null) {
    const { data: eventFunction, error: dateError } = await s.from("functions").select("on_date")
      .eq("wedding_id", call.wedding_id).eq("kind", call.function_kind).maybeSingle();
    if (dateError) throw dateError;
    functionDate = eventFunction?.on_date ?? null;
  }
  const facts = venueEvidence({
    callId,
    functionKind: call.function_kind,
    functionDate,
    channel: browser ? "browser_agent" : "samvaad_call",
    transcript,
    connected,
    originalTranscript: !!payload.original_transcript || fromAnalytics || english,
    variables: {
      ...variables,
      cutoff_wording: variables.cutoff_wording ?? variables.vendor_wording,
      cutoff_scope: variables.cutoff_scope === "sangeet_only" && call.function_kind === "sangeet"
        ? "amplified_music" : variables.cutoff_scope,
      cutoff_status: variables.cutoff_status ?? (variables.confirmed === "no" ? "unresolved" : undefined),
    },
  });
  const { data: applied, error: applyError } = await s.rpc("apply_call_evidence", {
    p_call: callId, p_evidence: facts, p_follow_ups: venueFollowUpCount({ connected, transcript }),
  });
  if (applyError) throw applyError;
  if (!applied) return "already";
  const latest = facts.at(-1);
  let told = false;
  try {
    const result = await runAgent(call.wedding_id, "call_result");
    told = result.status === "done" && result.actions.some((action) =>
      action.tool === "send_message" && String(action.result).startsWith("sent"));
  } catch (error) {
    console.error("agent after call result failed", error);
  }
  if (!told) await notifyCallResult(call.wedding_id, latest?.value ?? null, latest?.status === "confirmed");
  return "applied";
}

/** Replays every stored-but-unapplied result (NudgeBee recovery runbook step 3). */
export async function replayPending() {
  const { data, error } = await db().from("calls").select("id").not("result", "is", null).is("processed_at", null).order("result_received_at");
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const c of data ?? []) out[c.id] = await processCallResult(c.id);
  return out;
}

const resultCopy: Record<BaseLang, (t: string | null) => string> = {
  en: (t) => (t ? `📞 The venue answered: music must stop by <b>${t}</b>. The plan has been rechecked.` : "📞 The venue call ended without a clear answer. It stays open."),
  hi: (t) => (t ? `📞 वेन्यू ने बताया: संगीत <b>${t}</b> तक बंद करना होगा। प्लान दोबारा जाँचा गया।` : "📞 वेन्यू कॉल से साफ़ जवाब नहीं मिला। सवाल खुला है।"),
  mr: (t) => (t ? `📞 वेन्यूने सांगितलं: संगीत <b>${t}</b> पर्यंत बंद करावं लागेल. प्लॅन पुन्हा तपासला.` : "📞 वेन्यू कॉलवरून स्पष्ट उत्तर मिळालं नाही. प्रश्न खुला आहे."),
};
const openCopy: Record<BaseLang, string> = { en: "See the options", hi: "विकल्प देखें", mr: "पर्याय पाहा" };

async function notifyCallResult(weddingId: string, minute: number | null, confirmed: boolean) {
  const { data: members } = await db().from("members").select("tg_user_id, language").eq("wedding_id", weddingId);
  const time = confirmed && minute !== null ? `${Math.floor(minute / 60) % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${minute >= 720 ? "pm" : "am"}` : null;
  await Promise.allSettled(
    (members ?? [])
      .filter((m) => m.tg_user_id)
      .map((m) => {
        const lang = base(pickLang(m.language));
        const tt = time ? escapeHtml(time) : null;
        return Promise.all([
          localized({ en: resultCopy.en(tt), hi: resultCopy.hi(tt), mr: resultCopy.mr(tt) }, lang),
          localized(openCopy, lang),
        ]).then(([text, cta]) => sendWithApp(Number(m.tg_user_id), text, cta, `/tg?wedding=${weddingId}`));
      }),
  );
}

/** The rehearsal venue's answer, including a mid-call correction (the last answer wins). */
export async function simulateRehearsalAnswer(callId: string) {
  const reply = "Amplified music can play until 10 pm… actually, make it 10:30 pm for you.";
  await storeCallResult(callId, {
    attempt_id: `rehearsal-${callId}`,
    status: "connected",
    final_agent_variables: { cutoff_status: "confirmed", cutoff_scope: "amplified_music", cutoff_wording: reply },
    original_transcript: [
      { role: "agent", text: "Namaste, I'm an AI assistant calling for the Meera and Aarav families. By what time must amplified music stop at the Sangeet?" },
      { role: "user", text: reply },
      { role: "agent", text: "So amplified music can play until 10:30 pm. Thank you!" },
    ],
  });
  return processCallResult(callId);
}
