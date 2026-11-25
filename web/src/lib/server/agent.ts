import "server-only";
import { db } from "./supabase";
import { weddingFlags } from "./flags";
import { loadSnapshot } from "./plan";
import { logEvent } from "./weddings";
import { escapeHtml, send, sendWithApp } from "./telegram-bot";
import { chat, type ChatMessage, type ToolDef } from "./sarvam";
import { compile, fmtMinute } from "@/lib/compiler/compile";
import { pickLang, type BaseLang } from "@/lib/i18n";
import { localized } from "./translate";

/**
 * The always-on VivaahMesh agent. GLM-5.3 (Sarvam Token Factory) reads the wedding and decides
 * whether anyone needs to hear something. It wakes on family messages, vendor call results and a
 * heartbeat.
 *
 * Rules enforced in code (the model cannot change them, and neither can a flag):
 *  - It can message people and ask a parent to authorize a call. It cannot dial, book, approve or pay.
 *  - It never forwards one family's private note to the other family (checked before sending).
 *  - At most 3 messages per run; the same audience is not nudged twice within an hour.
 */

export type Trigger = "message" | "voice" | "call_result" | "heartbeat" | "manual";
type Audience = "sender" | "everyone" | "household_A" | "household_B" | "couple" | "deciders";
type Trilingual = { en: string; hi: string; mr: string };

const MAX_STEPS = 5;
const MAX_MESSAGES = 3;

interface Ctx {
  weddingId: string;
  trigger: Trigger;
  senderMemberId?: string;
  members: { id: string; tg_user_id: number | null; display_name: string; language: string; role: string; is_couple: boolean; household_id: string | null; side: "A" | "B" | null }[];
  privateNotes: { side: "A" | "B" | null; text: string }[];
  recentAudiences: Map<string, number>;
  sent: { audience: Audience; en: string; button?: string }[];
  summary?: Trilingual;
}

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "send_message",
      description:
        "Send a short Telegram message. Write it in all three languages; each person gets their own language. " +
        "audience: sender = the person who just wrote; everyone = both families; household_A / household_B = one family only; " +
        "couple = the couple only; deciders = the couple and the parents. Use button 'authorize_call' only with audience 'deciders' " +
        "when the plan is blocked on a vendor answer and no call has been authorized yet.",
      parameters: {
        type: "object",
        properties: {
          audience: { type: "string", enum: ["sender", "everyone", "household_A", "household_B", "couple", "deciders"] },
          en: { type: "string", description: "English, at most 3 short sentences, warm and plain" },
          hi: { type: "string", description: "Same message in Hindi (Devanagari)" },
          mr: { type: "string", description: "Same message in Marathi (Devanagari)" },
          button: { type: "string", enum: ["open_plan", "authorize_call", "none"] },
        },
        required: ["audience", "en", "hi", "mr"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Always call last. One line for the families' activity feed saying what you noticed and did (or why nothing was needed).",
      parameters: {
        type: "object",
        properties: { en: { type: "string" }, hi: { type: "string" }, mr: { type: "string" } },
        required: ["en", "hi", "mr"],
      },
    },
  },
];

const SYSTEM = `You are the VivaahMesh planning agent for one Indian wedding with two families.
You run all the time: you wake when a family member writes or sends a voice note, when a vendor call finishes, and on a regular heartbeat.
Your job is follow-through: notice what changed, tell the right people in their own language, and ask the right person to act.

Hard rules:
- You can only send messages and ask a parent or the couple to authorize a vendor call. You never dial, book, approve or pay, and never say you did.
- A note marked PRIVATE to one family must never be quoted or hinted at to the other family or to "everyone".
- Only state times and costs that appear in the plan below. Say "price pending" when a cost is unknown.
- Be brief: families are busy. One message is usually enough; often none is needed on a heartbeat.
- Do not repeat a message that appears in "Recent agent messages" unless something changed.
- When a family member writes to you, reply to them (audience "sender"): acknowledge what you understood, and say whether it is kept private to their family or shared.
- If the plan is blocked on the venue's music cutoff and no call is in progress or done, ask the deciders to authorize the call (button authorize_call), at most once.
- After a vendor call result, tell everyone what the vendor said and what the best option now is.
Always end by calling finish.`;

export async function runAgent(weddingId: string, trigger: Trigger, opts: { senderMemberId?: string; note?: string } = {}) {
  const s = db();
  const { data: wedding } = await s.from("weddings").select("*").eq("id", weddingId).single();
  if (!wedding) return { status: "skipped" as const, reason: "no_wedding" };

  const flags = await weddingFlags(weddingId, wedding.stage);
  if (!flags.features.agent_enabled.enabled) return { status: "skipped" as const, reason: "agent_enabled=off" };
  const model = flags.features.agent_model.value || "glm5.3-flash";

  // One run at a time per wedding.
  const { data: running } = await s
    .from("agent_runs")
    .select("id")
    .eq("wedding_id", weddingId)
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - 90_000).toISOString())
    .limit(1);
  if (running?.length) return { status: "skipped" as const, reason: "already_running" };

  const { data: run } = await s
    .from("agent_runs")
    .insert({ wedding_id: weddingId, trigger, model, flags: { agent_model: model, policy: flags.policy.version, strategy: flags.policy.strategy, source: flags.source } })
    .select("id")
    .single();

  const [hs, ms, ps, calls, runs, events] = await Promise.all([
    s.from("households").select("id, side, name").eq("wedding_id", weddingId),
    s.from("members").select("id, tg_user_id, display_name, language, role, is_couple, household_id").eq("wedding_id", weddingId),
    s.from("priorities").select("id, household_id, member_id, kind, note, transcript, visibility, source, created_at").eq("wedding_id", weddingId).order("created_at", { ascending: false }).limit(30),
    s.from("calls").select("status, recipient_name, created_at, processed_at, error").eq("wedding_id", weddingId).order("created_at", { ascending: false }).limit(3),
    s.from("agent_runs").select("trigger, actions, summary, started_at").eq("wedding_id", weddingId).neq("id", run!.id).order("started_at", { ascending: false }).limit(6),
    s.from("events").select("kind, payload, created_at").eq("wedding_id", weddingId).order("created_at", { ascending: false }).limit(15),
  ]);

  const sideOf = (hid: string | null) => (hs.data ?? []).find((h) => h.id === hid)?.side as "A" | "B" | null ?? null;
  const familyOf = (hid: string | null) => (hs.data ?? []).find((h) => h.id === hid)?.name ?? "?";
  const members = (ms.data ?? []).map((m) => ({ ...m, side: sideOf(m.household_id) }));
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.display_name ?? "someone";

  const ctx: Ctx = {
    weddingId,
    trigger,
    senderMemberId: opts.senderMemberId,
    members,
    privateNotes: (ps.data ?? []).filter((p) => p.visibility === "household").map((p) => ({ side: sideOf(p.household_id), text: `${p.note ?? ""} ${p.transcript ?? ""}` })),
    recentAudiences: new Map(),
    sent: [],
  };
  for (const r of runs.data ?? []) {
    for (const a of (r.actions as { tool: string; audience?: Audience }[]) ?? []) {
      if (a.tool === "send_message" && a.audience) ctx.recentAudiences.set(a.audience, Math.max(ctx.recentAudiences.get(a.audience) ?? 0, Date.parse(r.started_at)));
    }
  }

  // The plan, compiled with the Flagsmith policy, in plain English for the model.
  const snap = await loadSnapshot(weddingId);
  const result = snap ? compile(snap, flags.policy) : null;
  const title = (id: string) => snap?.activities.find((a) => a.id === id)?.title ?? id;
  const planText = !snap
    ? "No timed plan loaded yet."
    : [
        `Activities: ${snap.activities.map((a) => `${a.title} ${fmtMinute(a.start)}-${fmtMinute(a.end)}${a.requestedBy ? ` (asked by ${a.requestedBy.memberName}, Household ${a.requestedBy.side}, ${a.requestedBy.priority})` : ""}`).join("; ")}`,
        `Facts: ${snap.facts.map((f) => `${f.kind}=${f.value === null ? "unknown" : f.kind === "overtime_rate" ? `₹${f.value}/h` : fmtMinute(f.value)} [${f.status}, via ${f.source.channel}${f.source.wording ? `: "${f.source.wording}"` : ""}]`).join("; ")}`,
        `Conflicts: ${result!.conflicts.map((c) => `${title(c.activityId)} breaks ${c.constraint} by ${c.overByMin} min`).join("; ") || "none"}`,
        `Ranked options (policy ${result!.policyVersion}, ${flags.policy.strategy}): ${result!.proposals.map((p) => `#${p.rank} ${p.moves.map((m) => `${title(m.activityId)} → ${fmtMinute(m.to.start)}-${fmtMinute(m.to.end)}`).join(" + ")}, cost ${p.costDeltaInr === null ? "price pending" : `₹${p.costDeltaInr}`}, keeps: ${p.satisfies.join(", ")}`).join(" | ") || "none"}`,
        `Possible once confirmed: ${result!.conditional.map((p) => `${p.moves.map((m) => `${title(m.activityId)} → ${fmtMinute(m.to.start)}`).join(" + ")} if ${p.missing.question} (ask ${p.missing.askWhom})`).join(" | ") || "none"}`,
        `Blocked on: ${result!.blocking.map((b) => `${b.constraint} → ${b.whoCanResolve}`).join("; ") || "nothing"}`,
      ].join("\n");

  const context = [
    `Wedding: ${wedding.partner_a} & ${wedding.partner_b}, ${wedding.wedding_date ?? "date not set"}, ${wedding.city ?? ""}. Stage: ${wedding.stage}. Now: ${new Date().toISOString()}.`,
    `Families: ${(hs.data ?? []).map((h) => `Household ${h.side} = ${h.name}`).join("; ")}.`,
    `People: ${members.map((m) => `${m.display_name} (${m.is_couple ? "couple" : m.role}, Household ${m.side ?? "?"}, reads ${m.language})`).join("; ")}. (Write messages in English, Hindi and Marathi; people who read other languages get a Sarvam translation of the English.)`,
    `Family notes (newest first):\n${(ps.data ?? []).map((p) => `- ${nameOf(p.member_id)} of ${familyOf(p.household_id)} via ${p.source}: "${p.transcript ?? p.note ?? p.kind}"${p.visibility === "household" ? ` [PRIVATE to Household ${sideOf(p.household_id)}]` : " [shared]"}`).join("\n") || "none"}`,
    `Plan:\n${planText}`,
    `Vendor calls: ${(calls.data ?? []).map((c) => `${c.recipient_name}: ${c.status}${c.processed_at ? " (answer applied)" : ""} at ${c.created_at}`).join("; ") || "none yet"}`,
    `Recent agent messages:\n${(runs.data ?? []).flatMap((r) => ((r.actions as { tool: string; audience?: string; en?: string }[]) ?? []).filter((a) => a.tool === "send_message").map((a) => `- ${r.started_at} to ${a.audience}: ${a.en}`)).join("\n") || "none"}`,
    `Recent events: ${(events.data ?? []).map((e) => `${e.created_at} ${e.kind}`).join("; ")}`,
    "",
    trigger === "message" || trigger === "voice"
      ? `TRIGGER: ${nameOf(opts.senderMemberId ?? null)} just ${trigger === "voice" ? "sent a voice note" : "wrote"}: "${opts.note ?? ""}" (saved PRIVATE to their family).`
      : trigger === "call_result"
        ? "TRIGGER: a vendor call just finished and its answer was applied to the plan."
        : `TRIGGER: ${trigger}. Decide whether anyone needs to hear anything right now. Silence is fine.`,
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: context },
  ];
  const actions: Record<string, unknown>[] = [];
  let usage = { prompt_tokens: 0, completion_tokens: 0 };

  try {
    for (let step = 0; step < MAX_STEPS && !ctx.summary; step++) {
      const { message, usage: u } = await chat({ model, messages, tools: TOOLS, reasoning: "low" });
      usage = { prompt_tokens: usage.prompt_tokens + u.prompt_tokens, completion_tokens: usage.completion_tokens + u.completion_tokens };
      messages.push(message);
      if (!message.tool_calls?.length) {
        messages.push({ role: "user", content: "Call finish now with a one-line summary." });
        continue;
      }
      for (const call of message.tool_calls) {
        let args: Record<string, string> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* handled below as a bad call */
        }
        const out = await runTool(ctx, call.function.name, args);
        actions.push({ tool: call.function.name, ...args, result: out });
        messages.push({ role: "tool", tool_call_id: call.id, content: out });
      }
    }
    const summary = ctx.summary ?? { en: "Checked the plan.", hi: "प्लान जाँचा।", mr: "प्लॅन तपासला." };
    await s.from("agent_runs").update({ status: "done", summary, actions, ...usage, finished_at: new Date().toISOString() }).eq("id", run!.id);
    await logEvent(weddingId, null, "agent_run", { trigger, messages: ctx.sent.length });
    return { status: "done" as const, summary, actions };
  } catch (e) {
    await s.from("agent_runs").update({ status: "failed", error: String((e as Error).message).slice(0, 500), actions, ...usage, finished_at: new Date().toISOString() }).eq("id", run!.id);
    throw e;
  }
}

async function runTool(ctx: Ctx, name: string, a: Record<string, string>): Promise<string> {
  if (name === "finish") {
    if (!a.en) return "error: en is required";
    ctx.summary = { en: a.en, hi: a.hi || a.en, mr: a.mr || a.en };
    return "ok";
  }
  if (name !== "send_message") return `error: unknown tool ${name}`;

  const audience = a.audience as Audience;
  if (!a.en || !a.hi || !a.mr) return "error: write en, hi and mr";
  if (ctx.sent.length >= MAX_MESSAGES) return "refused: message limit for this run reached";
  if (audience === "sender" && !ctx.senderMemberId) return "refused: no sender on this trigger";
  const recipients = ctx.members.filter((m) => {
    if (!m.tg_user_id) return false;
    switch (audience) {
      case "sender": return m.id === ctx.senderMemberId;
      case "everyone": return true;
      case "household_A": return m.side === "A";
      case "household_B": return m.side === "B";
      case "couple": return m.is_couple;
      case "deciders": return m.is_couple || m.role === "parent";
      default: return false;
    }
  });
  if (!recipients.length) return "refused: nobody in that audience is on Telegram";

  // Rate limit on heartbeats: one nudge per audience per hour.
  const last = ctx.recentAudiences.get(audience);
  if (ctx.trigger === "heartbeat" && audience !== "sender" && last && Date.now() - last < 60 * 60_000) {
    return "refused: this audience was already messaged within the last hour";
  }

  // Privacy: a private note may only reach its own family.
  const text = `${a.en} ${a.hi} ${a.mr}`.toLowerCase();
  for (const n of ctx.privateNotes) {
    const leaksTo = recipients.some((r) => r.side !== n.side);
    if (!leaksTo) continue;
    const words = n.text.toLowerCase().split(/\s+/).filter(Boolean);
    for (let i = 0; i + 4 <= words.length; i++) {
      if (text.includes(words.slice(i, i + 4).join(" "))) return "refused: this would reveal one family's private note to the other family. Rephrase without it or send to that family only.";
    }
  }

  const button = a.button === "authorize_call" && audience === "deciders" ? "authorize_call" : a.button === "open_plan" ? "open_plan" : "none";
  const btnText: Record<BaseLang, Record<string, string>> = {
    en: { authorize_call: "Review the call", open_plan: "Open the plan" },
    hi: { authorize_call: "कॉल देखें", open_plan: "प्लान खोलें" },
    mr: { authorize_call: "कॉल पाहा", open_plan: "प्लॅन उघडा" },
  };
  const path = `/tg?wedding=${ctx.weddingId}${button === "authorize_call" ? "&screen=call" : ""}`;
  await Promise.allSettled(
    recipients.map(async (m) => {
      const lang = pickLang(m.language);
      // Marathi, Hindi and English come from the model; any other language is Sarvam-translated from English.
      const body = `🪔 ${escapeHtml(await localized({ en: a.en, hi: a.hi, mr: a.mr }, lang))}`;
      if (button === "none") return send(Number(m.tg_user_id), body);
      const label = await localized({ en: btnText.en[button], hi: btnText.hi[button], mr: btnText.mr[button] }, lang);
      return sendWithApp(Number(m.tg_user_id), body, label, path);
    }),
  );
  ctx.sent.push({ audience, en: a.en, button });
  return `sent to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}`;
}

/**
 * Heartbeat: wake the agent for weddings where something happened since its last run, or where
 * the plan has been blocked for a while. Quiet weddings cost nothing (no model call).
 */
export async function heartbeat(limit = 10) {
  const s = db();
  const { data: weddings } = await s.from("weddings").select("id").order("created_at", { ascending: false }).limit(50);
  const out: Record<string, string> = {};
  let ran = 0;
  for (const w of weddings ?? []) {
    if (ran >= limit) break;
    const [{ data: lastRun }, { data: lastEvent }] = await Promise.all([
      s.from("agent_runs").select("started_at").eq("wedding_id", w.id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      s.from("events").select("created_at, kind").eq("wedding_id", w.id).neq("kind", "agent_run").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const since = lastRun ? Date.parse(lastRun.started_at) : 0;
    const changed = lastEvent && Date.parse(lastEvent.created_at) > since;
    const stale = Date.now() - since > 6 * 60 * 60_000;
    if (!changed && !stale) {
      out[w.id] = "quiet";
      continue;
    }
    ran++;
    try {
      const r = await runAgent(w.id, "heartbeat");
      out[w.id] = r.status === "done" ? `done: ${r.summary.en}` : `skipped: ${r.reason}`;
    } catch (e) {
      out[w.id] = `failed: ${(e as Error).message.slice(0, 120)}`;
    }
  }
  return out;
}
