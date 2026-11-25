import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./supabase";
import { flagsForMember, killSwitch } from "./flags";
import { HttpError, logEvent, memberships } from "./weddings";
import { appUrl, escapeHtml, sendWithApp } from "./telegram-bot";
import { liveFactIds } from "@/lib/plan-input";
import { runAgent } from "./agent";
import { parseClock } from "@/lib/clock";
import { base, pickLang, type BaseLang } from "@/lib/i18n";
import { localized } from "./translate";

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
    .select("id, status, created_at, error, processed_at, recipient_name")
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
  status?: "connected" | "no_answer" | "busy" | "failed";
  final_agent_variables?: Record<string, unknown>;
  interaction_transcript?: { role: "agent" | "user"; en_text: string }[];
  failure_reason?: string;
}

/** Step 1 of the result path: persist verbatim, idempotently. Processing is a separate step. */
export async function storeCallResult(callId: string, payload: SarvamWebhook) {
  const s = db();
  const { data: call } = await s.from("calls").select("*").eq("id", callId).maybeSingle();
  if (!call) throw new HttpError(404, "unknown_call");
  if (call.result && call.processed_at) return { call, duplicate: true };
  const status = payload.status === "connected" ? "completed" : payload.status === "no_answer" || payload.status === "busy" ? "no_answer" : "failed";
  const { data: stored, error } = await s
    .from("calls")
    .update({ result: payload, result_received_at: new Date().toISOString(), status, error: payload.failure_reason ?? null, provider_attempt_id: call.provider_attempt_id ?? payload.attempt_id ?? null })
    .eq("id", callId)
    .select("*")
    .single();
  if (error) throw error;
  await logEvent(call.wedding_id, null, "call_result_stored", { call_id: callId, status });
  return { call: stored, duplicate: !!call.result };
}

/** What the vendor said, as a fact. Unclear answers stay unresolved: never guess a cutoff. */
export function factFromResult(payload: SarvamWebhook) {
  const v = payload.final_agent_variables ?? {};
  const said = (payload.interaction_transcript ?? []).filter((t) => t.role === "user").map((t) => t.en_text);
  const wording = String(v.vendor_wording ?? said.at(-1) ?? "").slice(0, 300);
  if (payload.status !== "connected") return { value: null, status: "unresolved" as const, wording: wording || "No answer" };
  const minute = parseClock(String(v.music_cutoff ?? ""));
  const sure = String(v.confirmed ?? "yes").toLowerCase() !== "no";
  return { value: minute, status: minute !== null && sure ? ("confirmed" as const) : ("unresolved" as const), wording };
}

/** Step 2: apply a stored result exactly once (claim → insert fact → link). */
export async function processCallResult(callId: string): Promise<"applied" | "paused" | "already" | "no_result"> {
  if (await killSwitch("result_processing_paused")) return "paused";
  const s = db();
  const { data: claimed } = await s
    .from("calls")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", callId)
    .is("processed_at", null)
    .not("result", "is", null)
    .select("*")
    .maybeSingle();
  if (!claimed) {
    const { data: c } = await s.from("calls").select("result").eq("id", callId).maybeSingle();
    return c?.result ? "already" : "no_result";
  }
  try {
    const payload = claimed.result as SarvamWebhook;
    const f = factFromResult(payload);
    if (claimed.flags?.channel === "browser" && f.status === "confirmed") {
      // Browser evidence uses fixed 24-hour HH:MM. The shared phone parser treats bare evening hours as PM.
      const [hours, minutes] = String(payload.final_agent_variables?.music_cutoff).split(":").map(Number);
      if (Number.isInteger(hours) && Number.isInteger(minutes)) f.value = hours * 60 + minutes;
    }
    const { data: prior } = await s
      .from("facts")
      .select("id, supersedes")
      .eq("wedding_id", claimed.wedding_id)
      .eq("kind", claimed.fact_kind)
      .eq("function_kind", claimed.function_kind);
    // A vendor's own answer replaces every earlier answer for the same term. An unclear one replaces nothing.
    const { data: fact, error } = await s
      .from("facts")
      .insert({
        wedding_id: claimed.wedding_id,
        kind: claimed.fact_kind,
        function_kind: claimed.function_kind,
        value: f.value,
        status: f.status,
        channel: claimed.flags?.channel === "browser" ? "browser_agent"
          : claimed.flags?.channel === "rehearsal" ? "seed" : "samvaad_call",
        ref: claimed.provider_attempt_id ?? claimed.id,
        wording: (claimed.flags as { channel?: string })?.channel === "rehearsal" ? `[Rehearsal] ${f.wording}` : f.wording,
        supersedes: f.status === "confirmed" ? liveFactIds(prior ?? []) : [],
      })
      .select("id")
      .single();
    if (error) throw error;
    await s.from("calls").update({ fact_id: fact.id }).eq("id", callId);
    await logEvent(claimed.wedding_id, null, "call_result_applied", { call_id: callId, value: f.value, status: f.status });
    // The agent explains the answer and the new best option to both families; the fixed message is the fallback.
    let told = false;
    try {
      const r = await runAgent(claimed.wedding_id, "call_result");
      told = r.status === "done" && r.actions.some((a) => a.tool === "send_message" && String(a.result).startsWith("sent"));
    } catch (e) {
      console.error("agent after call result failed", e);
    }
    if (!told) await notifyCallResult(claimed.wedding_id, f.value, f.status === "confirmed");
    return "applied";
  } catch (e) {
    // Release the claim so the replay can try again.
    await s.from("calls").update({ processed_at: null }).eq("id", callId);
    throw e;
  }
}

/** Replays every stored-but-unapplied result (NudgeBee recovery runbook step 3). */
export async function replayPending() {
  const { data } = await db().from("calls").select("id").not("result", "is", null).is("processed_at", null).order("result_received_at");
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
  await storeCallResult(callId, {
    attempt_id: `rehearsal-${callId}`,
    status: "connected",
    final_agent_variables: { music_cutoff: "22:30", confirmed: "yes", cutoff_scope: "whole_event", vendor_wording: "Music till ten… actually, make it ten-thirty for you." },
    interaction_transcript: [
      { role: "agent", en_text: "Namaste, I'm an AI assistant calling for the Meera and Aarav families. By what time must amplified music stop at the Sangeet?" },
      { role: "user", en_text: "Music till ten… actually, make it ten-thirty for you." },
      { role: "agent", en_text: "So amplified music can play until 10:30 pm. Thank you!" },
    ],
  });
  return processCallResult(callId);
}
