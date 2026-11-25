"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { tr, type Lang } from "@/lib/i18n";
import { api, haptic } from "@/lib/client/telegram";
import type { BudgetSummary, FunctionInfo, Vendor } from "@/lib/vendors";
import { formatINR } from "@/components/ui";
import { shareInvite } from "./shared";
import type { View } from "./types";

/** Mirror of the server's family view (src/lib/server/vendors.ts → familyVendors). */
interface Summary {
  isCouple: boolean;
  contact: { name: string; phone: string } | null;
  functions: FunctionInfo[];
  vendors: (Vendor & {
    accessCode: string | null;
    bookings: { id: string; title: string; status: string; totalInr: number | null; items: { functionId: string; brief: string; arrivalTime: string | null; approved: boolean }[] }[];
  })[];
  budget: BudgetSummary | null;
}

const POLL_MS = 8000;

/** The family's side of vendors and the run sheet. Shown only once the wedding reaches the day-of stage. */
export function VendorsCard({ view, lang }: { view: View; lang: Lang }) {
  const t = tr(lang);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Only the newest request may update the card, so a slow poll never overwrites a fresher result.
  const ticket = useRef(0);
  const couple = `${view.wedding.partnerA} & ${view.wedding.partnerB}`;

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const { vendors } = await api<{ vendors: Summary }>(`/api/vendors?wedding=${view.wedding.id}`);
      if (mine === ticket.current) setSummary(vendors);
    } catch {
      /* keep the last good summary */
    }
  }, [view.wedding.id]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  async function send(key: string, path: string, body: object) {
    setBusy(key);
    const mine = ++ticket.current;
    try {
      const out = await api<{ vendors: Summary }>(path, { body: { weddingId: view.wedding.id, ...body } });
      haptic.success();
      if (mine === ticket.current) setSummary(out.vendors);
    } catch {
      haptic.error();
    } finally {
      setBusy(null);
    }
  }

  async function share(v: Summary["vendors"][number]) {
    if (!v.accessCode) return;
    const res = await shareInvite(`${window.location.origin}/vendor/${v.accessCode}`, t.vendorShareText(couple, v.name));
    if (res === "copied") {
      setCopied(v.id);
      setTimeout(() => setCopied((c) => (c === v.id ? null : c)), 1800);
    }
  }

  if (!summary) return null;
  const fnTitle = (id: string) => summary.functions.find((f) => f.id === id)?.title ?? id;

  if (summary.vendors.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[14px] text-muted">{t.noVendorsYet}</p>
        {summary.isCouple ? (
          <button type="button" disabled={busy === "seed"} onClick={() => send("seed", "/api/vendors/seed", {})} className="pressable min-h-12 w-full rounded-2xl border border-dashed border-marigold/60 text-[15px] font-medium disabled:opacity-60">
            🧾 {t.loadSampleVendors} · <span className="text-muted">{t.sampleData}</span>
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {summary.budget ? (
        <div className="rounded-3xl border border-line bg-card px-5 py-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">{t.spendTitle}</p>
          <p className="mt-1 text-[15px]"><span className="text-muted">{t.spendCommitted}: </span><span className="font-medium">{formatINR(summary.budget.committedInr)}</span></p>
          <p className="text-[15px]"><span className="text-muted">{t.spendPlanned}: </span><span className="font-medium">{formatINR(summary.budget.plannedInr)}</span></p>
          {summary.budget.pricePending > 0 ? <p className="text-[13px] text-sindoor">{t.spendPending(summary.budget.pricePending)}</p> : null}
        </div>
      ) : null}

      <ul className="flex flex-col gap-3">
        {summary.vendors.map((v) => (
          <li key={v.id} className="rounded-3xl border border-line bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{v.name}</p>
                <p className="text-[12px] text-muted">
                  {t.vendorCategories[v.category] ?? v.category}
                  {v.isFamilyOwn ? ` · ${t.familyOwnVendor}` : ""}
                  {v.source === "seed" ? ` · ${t.sampleData}` : ""}
                </p>
              </div>
              {v.accessCode ? (
                <button type="button" onClick={() => share(v)} className="pressable min-h-10 shrink-0 rounded-xl border border-line px-3 text-[14px] font-medium">
                  {copied === v.id ? `✓ ${t.guestLinkCopied}` : t.copyGuestLink}
                </button>
              ) : null}
            </div>

            {v.bookings.map((b) => (
              <div key={b.id} className="mt-3 rounded-2xl bg-bg px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[14px] font-medium">{b.title}</p>
                  <span className="rounded-full bg-marigold-soft px-2.5 py-0.5 text-[12px] font-medium">{t.bookingStatuses[b.status] ?? b.status}</span>
                </div>
                <p className="text-[12px] text-muted">
                  {t.coversFunctions(b.items.length)}
                  {summary.isCouple ? ` · ${b.totalInr === null ? t.pricePending : formatINR(b.totalInr)}` : ""}
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {b.items.map((i) => (
                    <li key={i.functionId} className="flex items-center justify-between gap-2 text-[14px]">
                      <span className="min-w-0">
                        <span className="font-medium">{fnTitle(i.functionId)}</span>
                        <span className="block text-[12px] text-muted">{i.approved ? t.sharedWithVendor : t.notSharedYet}</span>
                      </span>
                      {summary.isCouple ? (
                        <button
                          type="button"
                          disabled={busy === `${b.id}:${i.functionId}`}
                          onClick={() => send(`${b.id}:${i.functionId}`, "/api/vendors/approve", { bookingId: b.id, functionId: i.functionId, approved: !i.approved })}
                          className="pressable min-h-9 shrink-0 rounded-full border border-line px-3 text-[13px] font-medium disabled:opacity-60"
                        >
                          {i.approved ? t.hideItem : t.shareItem}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
