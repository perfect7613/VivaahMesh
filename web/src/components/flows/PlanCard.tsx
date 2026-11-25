"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { dict, type Lang } from "@/lib/i18n";
import { api, haptic } from "@/lib/client/telegram";
import { fmtMinute } from "@/lib/compiler/compile";
import type { Activity, BlockingItem, CompileResult, FactKind, Reason, Requester, Resolver } from "@/lib/compiler/types";
import { formatINR } from "@/components/ui";
import type { View } from "./types";

/** Client mirror of the server's PlanView (src/lib/server/plan.ts). */
interface Plan {
  policy?: { version: string; strategy: string; source: string };
  snapshotRevision: number;
  activities: Activity[];
  facts: { id: string; kind: FactKind; functionKind: string; value: number | null; status: string }[];
  result: CompileResult;
}

const POLL_MS = 5000;

/**
 * Conflicts and ranked proposals, rendered identically on every household's phone: the facts
 * come from the one shared compile result, only the labels are in the viewer's language.
 * (Realtime push arrives with the shared-plan slice; until then this refreshes every few seconds.)
 */
export function PlanCard({ view, lang, onCallVenue }: { view: View; lang: Lang; onCallVenue?: () => void }) {
  const t = dict[lang];
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  const [seeding, setSeeding] = useState(false);
  // Every request takes a ticket; only the newest ticket may update the card. A slow poll that
  // started before a seed (or a fact) finished can therefore never overwrite the fresher plan.
  const ticket = useRef(0);

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const { plan } = await api<{ plan: Plan | null }>(`/api/plan?wedding=${view.wedding.id}`);
      if (mine === ticket.current) setPlan(plan);
    } catch {
      /* keep the last good plan on a flaky network */
    }
  }, [view.wedding.id]);

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
      if (mine === ticket.current) setPlan(plan);
    } catch {
      haptic.error();
    } finally {
      setSeeding(false);
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

  const { result, activities } = plan;
  const title = (id: string) => activities.find((a) => a.id === id)?.title ?? id;
  const familyOf = (side: string) => view.households.find((h) => h.side === side)?.name ?? `Household ${side}`;
  const requirements = activities.filter((a) => a.requestedBy);
  const label = (c: string) => t.constraintLabels[c] ?? c;

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
    b.code === "cutoff_unconfirmed" ? t.blockCutoffUnconfirmed
    : b.code === "contradiction" ? t.blockContradiction(label(b.factKind), b.values.map((v) => (b.factKind === "overtime_rate" ? formatINR(v) : fmtMinute(v))).join(" / "))
    : b.code === "no_slot" ? t.blockNoSlot(title(b.activityId), label(b.violated))
    : t.blockFixedConflict(title(b.activityId), label(b.violated), b.overByMin);

  const cost = (c: number | null) =>
    c === null ? <span className="font-medium text-sindoor">{t.pricePending}</span> : c === 0 ? <span className="text-muted">{t.noExtraCost}</span> : <span className="font-medium">+{formatINR(c)}</span>;

  const moveLabel = (m: CompileResult["proposals"][number]["moves"][number]) => {
    const extends_ = m.to.start === m.from.start && m.to.end > m.from.end;
    return extends_ ? t.extendTo(title(m.activityId), fmtMinute(m.to.end)) : t.moveTo(title(m.activityId), `${fmtMinute(m.to.start)}–${fmtMinute(m.to.end)}`);
  };

  return (
    <div className="mb-3 flex flex-col gap-3" aria-live="polite">
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
                  {" "}<span className="font-medium text-marigold">{t.askWhom(p.missing.askWhom)}</span>
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {result.conflicts.length > 0 && result.proposals.length === 0 && result.conditional.length === 0 ? (
        <p className="text-[14px] font-medium">{t.planNothingFits}</p>
      ) : null}

      {result.blocking.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{t.planWhoCanHelp}</h3>
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {result.blocking.map((b) => (
              <li key={`${b.constraint}|${b.whoCanResolve}`} className="rounded-2xl border border-line bg-card px-4 py-3">
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
        {t.planPolicy(result.policyVersion)}
        {plan.policy ? ` · ${t.strategies[plan.policy.strategy] ?? plan.policy.strategy}` : ""}
        {plan.policy?.source === "safe_defaults" ? ` · ${t.safeDefaults}` : plan.policy?.source === "flagsmith" ? " · Flagsmith" : ""}
      </p>
    </div>
  );
}
