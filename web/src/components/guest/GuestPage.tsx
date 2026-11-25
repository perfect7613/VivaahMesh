"use client";
import { useCallback, useEffect, useState } from "react";
import { dict, isBase, isRtl, registerDict, tr } from "@/lib/i18n";
import { MAX_PLATES, MEALS, ATTENDANCE, type Attendance, type GuestView, type Meal } from "@/lib/guests";

type Draft = { attendance: Attendance; plates: number; hampers: number; meal: Meal | null; needsAccessibility: boolean };
type Fn = GuestView["functions"][number];

const fromRsvp = (r: Fn["rsvp"]): Draft =>
  r ? { attendance: r.attendance, plates: r.plates || 1, hampers: r.hampers, meal: r.meal, needsAccessibility: r.needsAccessibility } : { attendance: "yes", plates: 1, hampers: 0, meal: null, needsAccessibility: false };

/** A guest's page, opened from their personal link: RSVP per function and the gift registry. */
export function GuestPage({ code }: { code: string }) {
  const [page, setPage] = useState<GuestView | null | undefined>(undefined);
  const [error, setError] = useState<"broken" | "closed" | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Draft>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setLoadedLangs] = useState(0);

  const lang = page?.guest.language ?? "en";
  const t = tr(lang);

  const post = useCallback(async (path: string, body: object) => {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, ...body }) });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as { page?: GuestView; error?: string } };
  }, [code]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/guest?code=${encodeURIComponent(code)}`)
      .then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) }))
      .then(({ ok, status, json }) => {
        if (!alive) return;
        if (ok) return setPage(json.page as GuestView);
        setPage(null);
        setError(status === 403 && json.error === "stage_locked" ? "closed" : "broken");
      })
      .catch(() => alive && (setPage(null), setError("broken")));
    return () => {
      alive = false;
    };
  }, [code]);

  // Languages beyond the hand-written three are translated on demand, as in the Mini App.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? "rtl" : "ltr";
    if (isBase(lang) || dict[lang]) return;
    let alive = true;
    fetch(`/api/i18n?lang=${lang}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.data && registerDict(lang, j.data))
      .catch(() => {})
      .finally(() => alive && setLoadedLangs((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [lang]);

  if (page === undefined) return <Shell><p className="animate-pulse text-center text-4xl" aria-label="Loading">🌼</p></Shell>;
  if (page === null) return <Shell><p className="text-center text-[16px]">{error === "closed" ? t.guestsNotOpen : t.guestLinkBroken}</p></Shell>;

  const couple = `${page.wedding.partnerA} & ${page.wedding.partnerB}`;
  const draftOf = (f: Fn): Draft => ({ ...fromRsvp(f.rsvp), ...edits[f.id] });
  const edit = (id: string, patch: Partial<Draft>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));

  async function saveRsvp(f: Fn) {
    const d = draftOf(f);
    setBusy(`rsvp:${f.id}`);
    setNotice(null);
    const r = await post("/api/guest/rsvp", { functionId: f.id, attendance: d.attendance, plates: d.attendance === "yes" ? d.plates : 0, hampers: d.attendance === "yes" ? d.hampers : 0, meal: d.attendance === "yes" ? d.meal : null, needsAccessibility: d.attendance === "yes" && d.needsAccessibility });
    setBusy(null);
    if (r.json.page) {
      setPage(r.json.page);
      setEdits((e) => ({ ...e, [f.id]: {} }));
      setSaved(f.id);
      setTimeout(() => setSaved((s) => (s === f.id ? null : s)), 2000);
    }
  }

  async function gift(kind: "reserve" | "release", itemId: string) {
    setBusy(`gift:${itemId}`);
    setNotice(null);
    const r = await post(`/api/guest/${kind}`, { itemId });
    setBusy(null);
    if (r.json.page) setPage(r.json.page);
    if (r.status === 409 && r.json.error === "sold_out") setNotice(t.giftJustTaken);
  }

  return (
    <Shell>
      <header className="mb-6">
        <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.18em] text-sindoor">{t.guestInvitedWith(page.guest.familyName)}</p>
        <h1 className="font-display text-[30px] leading-tight">{t.guestHello(page.guest.name)}</h1>
        <p className="mt-1 text-[16px] text-body">{couple}{page.wedding.city ? ` · ${page.wedding.city}` : ""}</p>
      </header>

      <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-muted">{t.guestRsvpTitle}</h2>
      <ul className="mb-8 flex flex-col gap-3">
        {page.functions.map((f) => {
          const d = draftOf(f);
          const yes = d.attendance === "yes";
          return (
            <li key={f.id} className="rounded-3xl border border-line bg-card p-4">
              <p className="font-display text-[20px]">{f.title}</p>
              <p className="mb-3 text-[13px] text-muted">{[f.onDate, f.startsAt?.slice(0, 5), f.venue].filter(Boolean).join(" · ")}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t.guestRsvpTitle}>
                {ATTENDANCE.map((a) => (
                  <button key={a} type="button" aria-pressed={d.attendance === a} onClick={() => edit(f.id, { attendance: a })}
                    className={`pressable min-h-10 rounded-full border px-4 text-[14px] font-medium ${d.attendance === a ? "border-marigold bg-marigold-soft" : "border-line"}`}>
                    {t.attendanceLabels[a]}
                  </button>
                ))}
              </div>
              {yes ? (
                <div className="mt-4 flex flex-col gap-3">
                  <Stepper label={t.platesLabel} hint={t.platesHint} value={d.plates} min={1} max={MAX_PLATES} onChange={(n) => edit(f.id, { plates: n })} />
                  <Stepper label={t.hampersLabel} value={d.hampers} min={0} max={MAX_PLATES} onChange={(n) => edit(f.id, { hampers: n })} />
                  <div>
                    <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">{t.mealLabel}</p>
                    <div className="flex flex-wrap gap-2">
                      {MEALS.map((m) => (
                        <button key={m} type="button" aria-pressed={d.meal === m} onClick={() => edit(f.id, { meal: d.meal === m ? null : m })}
                          className={`pressable min-h-9 rounded-full border px-3 text-[13px] ${d.meal === m ? "border-marigold bg-marigold-soft" : "border-line"}`}>
                          {t.mealLabels[m]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-[14px]">
                    <input type="checkbox" checked={d.needsAccessibility} onChange={(e) => edit(f.id, { needsAccessibility: e.target.checked })} className="size-4" />
                    {t.accessibilityLabel}
                  </label>
                </div>
              ) : null}
              <button type="button" disabled={busy === `rsvp:${f.id}`} onClick={() => saveRsvp(f)}
                className="pressable mt-4 min-h-11 w-full rounded-2xl bg-sindoor px-4 text-[15px] font-semibold text-white disabled:opacity-60">
                {saved === f.id ? t.rsvpSaved : t.saveRsvp}
              </button>
            </li>
          );
        })}
      </ul>

      {page.registry.length > 0 ? (
        <section aria-live="polite">
          <h2 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.18em] text-muted">{t.registryTitle}</h2>
          <p className="mb-3 text-[13px] text-muted">{t.registryHint}</p>
          {notice ? <p role="status" className="mb-3 rounded-2xl border border-marigold bg-marigold-soft px-4 py-3 text-[14px] font-medium">{notice}</p> : null}
          <ul className="overflow-hidden rounded-3xl border border-line bg-card">
            {page.registry.map((g, i) => (
              <li key={g.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${i ? "border-t border-line" : ""}`}>
                <div className="min-w-0">
                  <p className="font-medium">{g.title}</p>
                  <p className="text-[12px] text-muted">{g.mine ? t.reservedByYou : g.remaining > 0 ? t.remainingN(g.remaining) : t.giftTaken}</p>
                </div>
                {g.mine ? (
                  <button type="button" disabled={busy === `gift:${g.id}`} onClick={() => gift("release", g.id)} className="pressable min-h-10 rounded-xl border border-line px-3 text-[14px] disabled:opacity-60">{t.giveBack}</button>
                ) : g.remaining > 0 ? (
                  <button type="button" disabled={busy === `gift:${g.id}`} onClick={() => gift("reserve", g.id)} className="pressable min-h-10 rounded-xl bg-mehendi px-4 text-[14px] font-semibold text-white disabled:opacity-60">{t.reserveGift}</button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div className="toran" />
      <main className="relative mx-auto w-full max-w-md px-5 pb-16 pt-6">{children}</main>
    </div>
  );
}

function Stepper({ label, hint, value, min, max, onChange }: { label: string; hint?: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
        {hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={() => onChange(value - 1)} className="pressable grid size-10 place-items-center rounded-full border border-line text-xl disabled:opacity-40">−</button>
        <span className="w-6 text-center text-[17px] font-medium tabular-nums" aria-live="polite">{value}</span>
        <button type="button" aria-label={`${label} +`} disabled={value >= max} onClick={() => onChange(value + 1)} className="pressable grid size-10 place-items-center rounded-full border border-line text-xl disabled:opacity-40">+</button>
      </div>
    </div>
  );
}
