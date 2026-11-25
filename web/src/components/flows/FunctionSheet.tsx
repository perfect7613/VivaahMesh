"use client";
import { useState } from "react";
import { tr, type Lang } from "@/lib/i18n";
import { api, haptic, useBackButton, useMainButton } from "@/lib/client/telegram";
import { FallbackButton, Field, inputClass } from "@/components/ui";
import type { View } from "./types";

type Fn = View["functions"][number];

/** One function's details, filled in by the couple or a parent. `fn` null = adding a new one. */
export function FunctionSheet({ view, fn, lang, onClose, onSaved }: { view: View; fn: Fn | null; lang: Lang; onClose: () => void; onSaved: (v: View) => void }) {
  const t = tr(lang);
  const [title, setTitle] = useState(fn?.title ?? "");
  const [onDate, setOnDate] = useState(fn?.on_date ?? view.wedding.date ?? "");
  const [startsAt, setStartsAt] = useState(fn?.starts_at?.slice(0, 5) ?? "");
  const [venue, setVenue] = useState(fn?.venue ?? "");
  const [details, setDetails] = useState(fn?.details ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const can = title.trim().length > 0;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      let v: View;
      let id = fn?.id;
      if (!id) {
        v = (await api<{ view: View }>("/api/functions", { body: { weddingId: view.wedding.id, title } })).view;
        id = v.functions.find((f) => f.title.toLowerCase() === title.trim().toLowerCase())?.id;
      }
      v = (await api<{ view: View }>("/api/functions", { method: "PATCH", body: { functionId: id, title, onDate: onDate || null, startsAt: startsAt || null, venue, details } })).view;
      haptic.success();
      onSaved(v);
    } catch (e) {
      haptic.error();
      setError((e as Error).message);
      setSaving(false);
    }
  }
  useMainButton(t.save, save, { enabled: can, loading: saving });
  useBackButton(onClose);

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div className="toran" />
      <main className="step-enter relative mx-auto w-full max-w-md px-5 pb-32 pt-6">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-sindoor">{t.functionDetails}</p>
        <Field label={t.addFunction}>
          <input className={`${inputClass} font-display text-[22px]`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.customFunctionPlaceholder} maxLength={40} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.functionDate}>
            <input type="date" className={inputClass} value={onDate} onChange={(e) => setOnDate(e.target.value)} />
          </Field>
          <Field label={t.functionTime}>
            <input type="time" className={inputClass} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
        </div>
        <Field label={t.functionVenue}>
          <input className={inputClass} value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Shubh Mangal Lawns, Pune" maxLength={80} />
        </Field>
        <Field label={t.functionNotes}>
          <textarea className={`${inputClass} min-h-28 resize-none`} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={t.functionNotesPlaceholder} maxLength={400} />
        </Field>
        {error ? <p className="text-[14px] text-sindoor">{error === "parents_or_couple_only" ? t.callOnlyParents : error}</p> : null}
        <FallbackButton text={t.save} onClick={save} enabled={can} loading={saving} />
      </main>
    </div>
  );
}
