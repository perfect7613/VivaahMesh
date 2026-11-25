"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { tr, type Lang } from "@/lib/i18n";
import { api, haptic } from "@/lib/client/telegram";
import type { FunctionTotals } from "@/lib/guests";
import { inputClass } from "@/components/ui";
import { shareInvite } from "./shared";
import type { View } from "./types";

/** Mirror of the server's family summary (src/lib/server/guests.ts → familyGuestSummary). */
interface Summary {
  functions: { id: string; title: string }[];
  totals: Record<string, FunctionTotals>;
  guests: { id: string; name: string; householdSide: "A" | "B"; answered: number; accessCode: string | null }[];
  registry: { id: string; title: string; quantity: number; remaining: number; reservedBy: string[] }[];
}

const POLL_MS = 8000;

/** The family's side of RSVPs and the gift registry. Shown only once the wedding reaches the guests stage. */
export function GuestsCard({ view, lang }: { view: View; lang: Lang }) {
  const t = tr(lang);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [name, setName] = useState("");
  const [side, setSide] = useState<"A" | "B">("A");
  const [gift, setGift] = useState("");
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Only the newest request may update the card, so a slow poll never overwrites a fresher result.
  const ticket = useRef(0);
  const couple = `${view.wedding.partnerA} & ${view.wedding.partnerB}`;

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const { summary } = await api<{ summary: Summary }>(`/api/guests?wedding=${view.wedding.id}`);
      if (mine === ticket.current) setSummary(summary);
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

  async function send(path: string, body: object) {
    setBusy(true);
    const mine = ++ticket.current;
    try {
      const out = await api<{ summary: Summary; guest?: { accessCode: string } }>(path, { body: { weddingId: view.wedding.id, ...body } });
      haptic.success();
      if (mine === ticket.current) setSummary(out.summary);
      return out;
    } catch {
      haptic.error();
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addGuest() {
    if (!name.trim()) return;
    const out = await send("/api/guests", view.me.isCouple ? { name, side } : { name });
    if (out) setName("");
  }

  async function addGift() {
    if (!gift.trim()) return;
    const out = await send("/api/guests/registry", { title: gift, quantity: qty });
    if (out) {
      setGift("");
      setQty(1);
    }
  }

  async function share(g: Summary["guests"][number]) {
    if (!g.accessCode) return;
    const res = await shareInvite(`${window.location.origin}/guest/${g.accessCode}`, t.guestShareText(couple, g.name));
    if (res === "copied") {
      setCopied(g.id);
      setTimeout(() => setCopied((c) => (c === g.id ? null : c)), 1800);
    }
  }

  if (!summary) return null;
  const sideName = (s: "A" | "B") => view.households.find((h) => h.side === s)?.name ?? s;

  return (
    <div className="flex flex-col gap-5">
      <ul className="overflow-hidden rounded-3xl border border-line bg-card">
        {summary.functions.map((f, i) => {
          const x = summary.totals[f.id];
          const meals = (["veg", "jain", "non_veg"] as const).filter((m) => x.meals[m] > 0).map((m) => `${t.mealLabels[m]} ${x.meals[m]}`);
          return (
            <li key={f.id} className={`px-5 py-3.5 ${i ? "border-t border-line" : ""}`}>
              <p className="font-display text-[18px]">{f.title}</p>
              <p className="text-[13px] text-muted">{t.headcountLine(x.yes, x.maybe, x.no)}</p>
              <p className="text-[13px]">{t.totalsLine(x.plates, x.hampers)}{meals.length ? ` · ${meals.join(" · ")}` : ""}</p>
            </li>
          );
        })}
      </ul>

      {summary.guests.length === 0 ? <p className="text-[14px] text-muted">{t.noGuestsYet}</p> : (
        <ul className="flex flex-col gap-2">
          {summary.guests.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{g.name}</p>
                <p className="text-[12px] text-muted">{sideName(g.householdSide)} · {t.guestAnswered(g.answered, summary.functions.length)}</p>
              </div>
              {g.accessCode ? (
                <button type="button" onClick={() => share(g)} className="pressable min-h-10 shrink-0 rounded-xl border border-line px-3 text-[14px] font-medium">
                  {copied === g.id ? `✓ ${t.guestLinkCopied}` : t.copyGuestLink}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        {view.me.isCouple ? (
          <div className="flex gap-2" role="group">
            {(["A", "B"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)} className={`pressable min-h-9 flex-1 rounded-full border px-3 text-[13px] ${side === s ? "border-marigold bg-marigold-soft" : "border-line"}`}>{sideName(s)}</button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <input className={`${inputClass} !py-3`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t.guestNamePlaceholder} aria-label={t.addGuest} />
          <button type="button" disabled={busy || !name.trim()} onClick={addGuest} className="pressable min-h-12 shrink-0 rounded-2xl bg-sindoor px-4 text-[15px] font-semibold text-white disabled:opacity-50">＋</button>
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">{t.registryTitle}</h3>
        {summary.registry.length > 0 ? (
          <ul className="mb-3 overflow-hidden rounded-3xl border border-line bg-card">
            {summary.registry.map((g, i) => (
              <li key={g.id} className={`px-5 py-3 ${i ? "border-t border-line" : ""}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{g.title}</p>
                  <p className="text-[13px] text-muted">{g.remaining > 0 ? t.remainingN(g.remaining) : t.giftTaken}</p>
                </div>
                {g.reservedBy.length ? <p className="text-[12px] text-mehendi">{t.reservedByNames(g.reservedBy.join(", "))}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {view.me.isCouple ? (
          <div className="flex gap-2">
            <input className={`${inputClass} !py-3`} value={gift} maxLength={120} onChange={(e) => setGift(e.target.value)} placeholder={t.giftPlaceholder} aria-label={t.addGift} />
            <input className={`${inputClass} !w-20 !py-3 text-center`} type="number" min={1} max={100} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} aria-label={t.platesLabel} />
            <button type="button" disabled={busy || !gift.trim()} onClick={addGift} className="pressable min-h-12 shrink-0 rounded-2xl bg-mehendi px-4 text-[15px] font-semibold text-white disabled:opacity-50">＋</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
