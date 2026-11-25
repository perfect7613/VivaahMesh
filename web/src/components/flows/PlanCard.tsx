"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { tr, type Lang } from "@/lib/i18n";
import { ApiError, api, haptic } from "@/lib/client/telegram";
import { useWeddingLive } from "@/lib/client/live";
import { fmtMinute } from "@/lib/compiler/compile";
import type { Activity, BlockingItem, CompileResult, FactKind, Reason, Requester, Resolver } from "@/lib/compiler/types";
import { formatINR } from "@/components/ui";
import { AskMakeupArtist, MakeupReplies, type MakeupEnquiryView } from "./MakeupEnquiry";
import type { View } from "./types";

type Stance = "agree" | "prefer_other" | "object";
const STANCES: Stance[] = ["agree", "prefer_other", "object"];

/** Client mirror of the server's PlanView (src/lib/server/plan.ts). */
interface Plan {
  revision: number;
  activities: Activity[];
  facts: { id: string; kind: FactKind; functionKind: string; value: number | null; status: string }[];
  result: CompileResult;
  policy: { version: string; strategy: string; source: string };
  responses: { householdId: string; side: "A" | "B"; family: string; memberName: string; proposalId: string; stance: Stance; note: string; updatedAt: string }[];
  committed: {
    revision: number;
    proposalId: string;
    approvedBy: string;
    approvedAt: string;
    recap: { revision: number; moves: { activityId: string; title: string; from: { start: number; end: number }; to: { start: number; end: number } }[]; costDeltaInr: number | null; reasons: Reason[] };
  } | null;
  canRespond: boolean;
  canApprove: boolean;
  makeupEnquiries?: MakeupEnquiryView[];
}

const POLL_MS = 5000;

/**
 * Conflicts and ranked proposals, rendered identically on every household's phone: the facts
 * come from the one shared compile result, only the labels are in the viewer's language.
 * (Realtime push arrives with the shared-plan slice; until then this refreshes every few seconds.)
 */
export function PlanCard({ view, lang, onCallVenue }: { view: View; lang: Lang; onCallVenue?: () => void }) {
  const t = tr(lang);
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  const [seeding, setSeeding] = useState(false);
  /** Which action is in flight, e.g. "approve:dance@9:40 pm", to disable its buttons. */
  const [busy, setBusy] = useState<string | null>(null);
  /** Shown above the card, e.g. "the plan changed while you were looking". */
  const [notice, setNotice] = useState<string | null>(null);
  // Every request takes a ticket; only the newest ticket may update the card. A slow poll that
  // started before a seed (or a fact) finished can therefore never overwrite the fresher plan.
  const ticket = useRef(0);
  /** The newest revision shown, so a late reply can be judged by revision rather than by timing. */
  const shownRevision = useRef(0);

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const { plan } = await api<{ plan: Plan | null }>(`/api/plan?wedding=${view.wedding.id}`);
      if (mine === ticket.current) {
        shownRevision.current = plan?.revision ?? 0;
        setPlan(plan);
      }
    } catch {
      /* keep the last good plan on a flaky network */
    }
  }, [view.wedding.id]);
  // Live: another phone changed something → refetch within a second (polling remains the fallback).
  useWeddingLive(view.wedding.id, load);

  useEffect(() => {
    const first = setTimeout(load, 0);
    // No polling while the app is in the background; refresh as soon as it is visible again.
    const id = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  async function seed() {
    setSeeding(true);
    const mine = ++ticket.current;
    try {
      const { plan } = await api<{ plan: Plan | null }>("/api/plan", { body: { weddingId: view.wedding.id } });
      haptic.success();
      if (mine === ticket.current) {
        shownRevision.current = plan?.revision ?? 0;
        setPlan(plan);
      }
    } catch {
      haptic.error();
    } finally {
      setSeeding(false);
    }
  }

  /**
   * Respond or approve against the revision the viewer is looking at. If a newer revision exists
   * the server answers 409 with it: show that newer plan instead of failing silently.
   */
  async function act(kind: "respond" | "approve", body: Record<string, unknown>) {
    if (!plan) return;
    setBusy(`${kind}:${body.proposalId}`);
    setNotice(null);
    const mine = ++ticket.current;
    try {
      const { plan: next } = await api<{ plan: Plan | null }>(`/api/plan/${kind}`, { body: { weddingId: view.wedding.id, revision: plan.revision, ...body } });
      haptic.success();
      if (mine === ticket.current) {
        shownRevision.current = next?.revision ?? 0;
        setPlan(next);
      }
    } catch (e) {
      haptic.error();
      if (e instanceof ApiError && e.status === 409) {
        const next = (e.body as { plan?: Plan | null }).plan;
        if (e.message === "stale" && next) {
          // Always tell the viewer, even if a poll overtook this request. Apply the plan when it
          // is newer than what is on screen: judged by revision, not by which request finished last.
          if (next.revision >= shownRevision.current) {
            shownRevision.current = next.revision;
            setPlan(next);
          }
          setNotice(t.staleNotice(next.revision));
        } else if (e.message === "already_approved") {
          setNotice(t.alreadyApproved);
          load();
        }
      }
    } finally {
      setBusy(null);
    }
  }

  if (plan === undefined) return null;
  if (plan === null) {
    return view.me.isCouple ? (
      <button type="button" onClick={seed} disabled={seeding} className="pressable mb-3 min-h-12 w-full rounded-2xl border border-dashed border-marigold/60 text-[15px] font-medium disabled:opacity-60">
        🎶 {t.loadDemoPlan} · <span className="text-muted">{t.sampleData}</span>
      </button>
    ) : null;
  }

  const { result, activities, makeupEnquiries = [] } = plan;
  const title = (id: string) => activities.find((a) => a.id === id)?.title ?? id;
  const familyOf = (side: string) => view.households.find((h) => h.side === side)?.name ?? `Household ${side}`;
  const requirements = activities.filter((a) => a.requestedBy);
  const label = (c: string) => t.constraintLabels[c] ?? c;
  const fnTitle = (kind: string) => view.functions.find((f) => f.kind === kind)?.title ?? kind;

  // Every sentence below is built from structured compiler output, in the viewer's language.
  const by = (r?: Requester) => (r ? ` (${t.reasonBy(r.memberName, familyOf(r.side), t.priorityLevels[r.priority])})` : "");
  const reasonText = (r: Reason) =>
    r.code === "dinner_kept" ? t.reasonDinnerKept(fmtMinute(r.at), r.noDanceDuring) + by(r.by)
    : r.code === "duration_kept" ? t.reasonDurationKept(title(r.activityId), r.minutes) + by(r.by)
    : t.reasonVideoCovered;
  const resolverText = (r: Resolver) => {
    const role = r.role === "household" && r.side ? familyOf(r.side) : t.resolverRoles[r.role];
    return r.name ? `${role} (${r.name})` : role;
  };
  const blockingText = (b: BlockingItem) =>
    b.code === "cutoff_unconfirmed" ? t.blockCutoffUnconfirmed(fnTitle(b.functionKind))
    : b.code === "contradiction" ? t.blockContradiction(label(b.factKind), b.values.map((v) => (b.factKind === "overtime_rate" ? formatINR(v) : fmtMinute(v))).join(" / "))
    : b.code === "no_slot" ? t.blockNoSlot(title(b.activityId), label(b.violated))
    : t.blockFixedConflict(title(b.activityId), label(b.violated), b.overByMin);

  const cost = (c: number | null) =>
    c === null ? <span className="font-medium text-sindoor">{t.pricePending}</span> : c === 0 ? <span className="text-muted">{t.noExtraCost}</span> : <span className="font-medium">+{formatINR(c)}</span>;

  const moveLabel = (m: { activityId: string; from: { start: number; end: number }; to: { start: number; end: number } }, name = title(m.activityId)) => {
    const extends_ = m.to.start === m.from.start && m.to.end > m.from.end;
    return extends_ ? t.extendTo(name, fmtMinute(m.to.end)) : t.moveTo(name, `${fmtMinute(m.to.start)}–${fmtMinute(m.to.end)}`);
  };

  const optionName = (id: string) => {
    const p = result.proposals.find((x) => x.id === id);
    if (p) return t.optionN(p.rank);
    const c = result.conditional.find((x) => x.id === id);
    return c ? t.possibleOptionN(c.rank) : id;
  };
  const myResponse = plan.responses.find((r) => r.householdId === view.me.householdId);

  /** Both households' answers on this option, plus this household's buttons and the couple's approval. */
  const decide = (proposalId: string, approvable: boolean) => {
    const here = plan.responses.filter((r) => r.proposalId === proposalId);
    return (
      <div className="mt-2.5 flex flex-col gap-2">
        {here.length ? (
          <ul className="flex flex-wrap gap-1.5 text-[12px]">
            {here.map((r) => (
              <li key={r.householdId} className={`rounded-full px-2.5 py-0.5 ${r.stance === "agree" ? "bg-mehendi/15 text-mehendi" : r.stance === "object" ? "bg-sindoor/10 text-sindoor" : "bg-marigold-soft"}`}>
                {r.family}: {t.stanceLabels[r.stance]}
              </li>
            ))}
          </ul>
        ) : null}
        {plan.canRespond ? (
          <div className="flex flex-wrap gap-1.5" role="group">
            {STANCES.map((st) => {
              const chosen = myResponse?.proposalId === proposalId && myResponse.stance === st;
              return (
                <button
                  key={st}
                  type="button"
                  disabled={!!busy}
                  aria-pressed={chosen}
                  onClick={() => act("respond", { proposalId, stance: st })}
                  className={`pressable min-h-9 rounded-full border px-3 text-[13px] font-medium disabled:opacity-60 ${chosen ? "border-marigold bg-marigold-soft" : "border-line"}`}
                >
                  {t.stanceLabels[st]}
                </button>
              );
            })}
          </div>
        ) : null}
        {plan.canApprove && approvable ? (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => act("approve", { proposalId })}
            className="pressable min-h-11 rounded-2xl bg-sindoor px-4 text-[14px] font-semibold text-white disabled:opacity-60"
          >
            {busy === `approve:${proposalId}` ? t.approving : t.approveRevision(plan.revision)}
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="mb-3 flex flex-col gap-3" aria-live="polite">
      {notice ? <p role="status" className="rounded-2xl border border-marigold bg-marigold-soft px-4 py-3 text-[14px] font-medium">🔄 {notice}</p> : null}

      {plan.committed ? (
        <div className="rounded-2xl border border-mehendi/40 bg-mehendi/10 px-4 py-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-mehendi">✓ {t.committedTitle}</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {plan.committed.recap.moves.map((m) => (<li key={m.activityId} className="font-medium">{moveLabel(m, m.title)}</li>))}
          </ul>
          <p className="mt-0.5 text-[13px]">{cost(plan.committed.recap.costDeltaInr)}</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-[13px] text-muted">
            {plan.committed.recap.reasons.map((r, i) => (<li key={i}>✓ {reasonText(r)}</li>))}
          </ul>
          <p className="mt-1.5 text-[12px] text-muted">{t.committedBy(plan.committed.approvedBy, plan.committed.revision)}</p>
        </div>
      ) : (
        <p className="text-[13px] text-muted">{t.noCommittedYet}</p>
      )}

      {result.conflicts.length === 0 ? (
        <p className="rounded-2xl border border-line bg-card px-4 py-3 text-[15px]">✓ {t.planAllClear}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.conflicts.map((c, i) => {
            const a = activities.find((x) => x.id === c.activityId);
            return (
              <li key={`${c.activityId}-${c.constraint}-${i}`} className="rounded-2xl border border-sindoor/50 bg-sindoor/10 px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-sindoor">{t.planNeedsChange} · {label(c.constraint)}</p>
                <p className="mt-0.5 font-medium">{title(c.activityId)}{a ? ` · ${fmtMinute(a.start)}–${fmtMinute(a.end)}` : ""}</p>
                <p className="text-[14px] text-sindoor">{t.overBy(c.overByMin)}</p>
              </li>
            );
          })}
        </ul>
      )}

      {result.proposals.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{t.planOptions}</h3>
          <ol className="flex flex-col gap-2">
            {result.proposals.map((p) => (
              <li key={p.id} className="rounded-2xl border border-line bg-card px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-marigold-soft text-[13px] font-semibold">{p.rank}</span>
                  <div className="min-w-0 flex-1">
                    {p.moves.map((m) => (<p key={m.activityId} className="font-medium">{moveLabel(m)}</p>))}
                    <p className="mt-0.5 text-[13px]">{cost(p.costDeltaInr)}</p>
                    <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-muted">
                      {p.reasons.map((r, i) => (<li key={i}>✓ {reasonText(r)}</li>))}
                    </ul>
                    {decide(p.id, true)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {result.conditional.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{t.planConditional}</h3>
          <ol className="flex flex-col gap-2">
            {result.conditional.map((p) => (
              <li key={p.id} className="rounded-2xl border border-dashed border-marigold/60 bg-marigold-soft/40 px-4 py-3">
                {p.moves.map((m) => (<p key={m.activityId} className="font-medium">{moveLabel(m)}</p>))}
                <p className="mt-0.5 text-[13px]">{cost(p.costDeltaInr)}</p>
                <p className="mt-1.5 text-[14px]">
                  <span className="text-muted">{t.needsAnswer}: </span>
                  {p.missing.factKind === "makeup_ready" && p.missing.byMinute !== undefined ? t.askMakeup(p.missing.askWhom, fmtMinute(p.missing.byMinute)) : p.missing.question}
                </p>
                {p.missing.factKind === "makeup_ready" && p.missing.byMinute !== undefined ? (
                  <AskMakeupArtist
                    key={`${p.id}:${p.missing.byMinute}`}
                    weddingId={view.wedding.id}
                    proposalId={p.id}
                    artist={p.missing.askWhom}
                    readyBy={p.missing.byMinute}
                    enquired={makeupEnquiries.find((enquiry) => enquiry.proposalId === p.id && enquiry.readyBy === p.missing.byMinute)}
                    canAsk={view.me.isCouple || view.me.role === "parent"}
                    lang={lang}
                    onUpdate={load}
                  />
                ) : <p className="text-sm font-medium">{t.askWhom(p.missing.askWhom)}</p>}

                {/* Families can weigh in, but a conditional option cannot be approved until the answer is in. */}
                {decide(p.id, false)}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <MakeupReplies enquiries={makeupEnquiries} lang={lang} />

      {result.conflicts.length > 0 && result.proposals.length === 0 && result.conditional.length === 0 ? (
        <p className="text-[14px] font-medium">{t.planNothingFits}</p>
      ) : null}

      {result.blocking.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{t.planWhoCanHelp}</h3>
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {result.blocking.map((b) => (
              <li key={`${b.functionKind}|${b.constraint}|${b.whoCanResolve}`} className="rounded-2xl border border-line bg-card px-4 py-3">
                <span>{blockingText(b)}</span> <span className="text-muted">→ {resolverText(b.resolver)}</span>
                {b.code === "cutoff_unconfirmed" && onCallVenue && (view.me.isCouple || view.me.role === "parent") ? (
                  <button
                    type="button"
                    onClick={onCallVenue}
                    className="pressable mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sindoor text-[15px] font-semibold text-white shadow-[0_10px_24px_-14px_var(--sindoor)]"
                  >
                    📞 {t.callVenue}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.proposals.length + result.conditional.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{t.responsesTitle}</h3>
          <ul className="overflow-hidden rounded-2xl border border-line bg-card text-[14px]">
            {view.households.map((h, i) => {
              const r = plan.responses.find((x) => x.householdId === h.id);
              return (
                <li key={h.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${i ? "border-t border-line" : ""}`}>
                  <span className="font-medium">{h.name}</span>
                  <span className="text-right text-[13px] text-muted">
                    {r ? `${t.stanceLabels[r.stance]} · ${optionName(r.proposalId)}${r.memberName ? ` · ${r.memberName}` : ""}` : t.noResponseYet}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {requirements.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{t.requirementsBy}</h3>
          <ul className="overflow-hidden rounded-2xl border border-line bg-card text-[14px]">
            {requirements.map((a, i) => (
              <li key={a.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${i ? "border-t border-line" : ""}`}>
                <span className="min-w-0"><span className="font-medium">{a.title}</span> <span className="text-muted">{fmtMinute(a.start)}</span></span>
                <span className="shrink-0 text-right text-[12px] text-muted">{a.requestedBy!.memberName} · {familyOf(a.requestedBy!.side)} · {t.priorityLevels[a.requestedBy!.priority]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[12px] text-muted">
        {t.revisionLabel(plan.revision)} · {t.planPolicy(result.policyVersion)}
        {` · ${t.strategies[plan.policy.strategy] ?? plan.policy.strategy}`}
        {plan.policy.source === "safe_defaults" ? ` · ${t.safeDefaults}` : plan.policy.source === "flagsmith" ? " · Flagsmith" : ""}
      </p>
    </div>
  );
}
