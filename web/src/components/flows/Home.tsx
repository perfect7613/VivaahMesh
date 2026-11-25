"use client";
import { useState } from "react";
import { dict, pickLang, type Lang } from "@/lib/i18n";
import { api, haptic, useBackButton, useMainButton } from "@/lib/client/telegram";
import { Chip, FallbackButton, Field, Petals, PrivacyNote, inputClass, formatINR } from "@/components/ui";
import { InvitationCard } from "./InvitationCard";
import { inviteLink, shareInvite } from "./shared";
import type { View } from "./types";

const FN_EMOJI: Record<string, string> = { engagement: "💍", haldi: "🌼", mehendi: "🌿", sangeet: "🎶", ceremony: "🔥", reception: "✨", other: "🎉" };
const PRIORITY_KEYS = ["elders_dinner", "pure_veg", "muhurat", "dance", "accessibility", "budget_care", "music_late", "photos"];

function daysUntil(date: string | null) {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime();
  return Math.max(0, Math.round(d / 86400000));
}

export function Home({ view, setView, botUsername, celebrate }: { view: View; setView: (v: View) => void; botUsername: string; celebrate: "created" | "joined" | null }) {
  const lang: Lang = pickLang(view.me.language);
  const t = dict[lang];
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const couple = `${view.wedding.partnerA} & ${view.wedding.partnerB}`;
  const myHousehold = view.households.find((h) => h.id === view.me.householdId);
  const other = view.households.find((h) => h.id !== view.me.householdId);
  const days = daysUntil(view.wedding.date);

  async function invite(code: string, family: string, key: string) {
    haptic.tap();
    const res = await shareInvite(inviteLink(botUsername, code), t.inviteShareText(couple, family));
    if (res === "copied") {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    }
  }

  const tasks: { key: string; label: string; action?: () => void }[] = [];
  if (other && other.members.length === 0 && other.inviteCode) {
    tasks.push({ key: "invite-other", label: t.taskInviteOther(other.name), action: () => invite(other.inviteCode!, other.name, "invite-other") });
  }
  if (!view.priorities.some((p) => p.family === myHousehold?.name)) {
    tasks.push({ key: "priorities", label: t.taskAddPriorities, action: () => setAdding(true) });
  }
  if (view.me.isCouple && !view.wedding.date) tasks.push({ key: "date", label: t.taskSetDate });

  if (adding) {
    return <AddWish view={view} lang={lang} onClose={() => setAdding(false)} onSaved={(v) => { setView(v); setAdding(false); }} />;
  }

  return (
    <main className="mx-auto w-full max-w-md px-5 pb-16 pt-5">
      {celebrate ? <Petals /> : null}
      <div className="rise flex flex-col gap-5">
        <section>
          {celebrate ? (
            <div className="mb-4 text-center">
              <h1 className="font-display text-[26px] leading-tight">{celebrate === "created" ? t.createdTitle : t.welcomeTitle(view.me.displayName)}</h1>
              {celebrate === "created" ? <p className="mt-1.5 text-[15px] text-muted">{t.createdHint}</p> : null}
            </div>
          ) : null}
          <InvitationCard
            couple={couple}
            date={view.wedding.date}
            city={view.wedding.city}
            lang={lang}
            footer={days != null ? t.daysToGo(days) : t.dateTbd}
          />
        </section>

        {tasks.length ? (
          <Section title={t.needsYou} accent>
            <ul className="flex flex-col gap-2">
              {tasks.map((task) => (
                <li key={task.key}>
                  <button type="button" onClick={task.action} className="pressable flex min-h-14 w-full items-center gap-3 rounded-2xl border border-marigold/50 bg-marigold-soft px-4 py-3 text-left">
                    <span className="size-2.5 shrink-0 rounded-full bg-sindoor" aria-hidden />
                    <span className="flex-1 font-medium">{copied === task.key ? "✓ Link copied" : task.label}</span>
                    <span aria-hidden className="text-muted">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title={t.families}>
          <div className="grid grid-cols-2 gap-3">
            {view.households.map((h) => (
              <div key={h.id} className="flex flex-col rounded-2xl border border-line bg-card p-4">
                <p className="font-medium leading-snug">{h.name}</p>
                <p className="mb-3 text-[13px] text-muted">{h.members.length ? t.joined(h.members.length) : t.waitingToJoin}</p>
                <div className="mb-3 flex -space-x-2">
                  {h.members.slice(0, 5).map((m) => (
                    <span key={m.id} title={m.name} className="grid size-8 place-items-center rounded-full border-2 border-card bg-marigold-soft text-[13px] font-semibold">
                      {m.name.slice(0, 1).toUpperCase()}
                    </span>
                  ))}
                </div>
                {h.inviteCode ? (
                  <button type="button" onClick={() => invite(h.inviteCode!, h.name, h.id)} className="pressable mt-auto min-h-10 rounded-xl border border-line text-sm font-medium">
                    {copied === h.id ? "✓ Copied" : "＋ Invite"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {view.me.isCouple && view.wedding.coupleCode ? (
            <button
              type="button"
              onClick={() => invite(view.wedding.coupleCode!, other?.name ?? "", "partner")}
              className="pressable mt-3 min-h-12 w-full rounded-2xl border border-dashed border-marigold/60 text-[15px] font-medium"
            >
              {copied === "partner" ? "✓ Link copied" : `💌 ${t.invitePartner}`}
            </button>
          ) : null}
        </Section>

        <Section title={t.thePlan}>
          <ul className="overflow-hidden rounded-2xl border border-line bg-card">
            {view.functions.map((f, i) => (
              <li key={f.id} className={`flex items-center gap-3 px-4 py-3.5 ${i ? "border-t border-line" : ""}`}>
                <span className="text-xl" aria-hidden>{FN_EMOJI[f.kind] ?? "🎉"}</span>
                <span className="flex-1 font-medium">{f.title}</span>
                <span className="text-[13px] text-muted">—</span>
              </li>
            ))}
          </ul>
          {view.me.isCouple && (view.wedding.guestCount || view.wedding.budgetInr) ? (
            <p className="mt-2 flex flex-wrap gap-x-4 text-[13px] text-muted">
              {view.wedding.guestCount ? <span>👥 {view.wedding.guestCount}</span> : null}
              {view.wedding.budgetInr ? <span>🔒 {formatINR(view.wedding.budgetInr)}</span> : null}
            </p>
          ) : null}
        </Section>

        <Section title={t.teamHandling}>
          <ul className="flex flex-col gap-2 text-[15px]">
            {[t.teamBrief, t.teamVendors].map((x) => (
              <li key={x} className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3">
                <span className="relative flex size-2.5" aria-hidden>
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-mehendi opacity-50" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-mehendi" />
                </span>
                {x}
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t.priorities} action={<button type="button" onClick={() => setAdding(true)} className="pressable rounded-full px-3 py-1 text-sm font-medium text-marigold">＋ {t.addPriority}</button>}>
          {view.priorities.length ? (
            <ul className="flex flex-col gap-2">
              {view.priorities.map((p) => (
                <li key={p.id} className="rounded-2xl border border-line bg-card px-4 py-3">
                  <p className="text-[15px]">{p.kind === "note" ? p.note : t.priorityPresets[p.kind] ?? p.kind}</p>
                  <div className="mt-1.5 flex items-center justify-between text-[12px] text-muted">
                    <span>{t.sharedBy(p.author, p.family)}{p.source !== "app" ? ` · via ${p.source}` : ""}</span>
                    <span className={p.visibility === "household" ? "text-mehendi" : ""}>{p.visibility === "household" ? `🔒 ${t.private}` : `👥 ${t.shared}`}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-[13px] text-muted">{t.tipChat}</p>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children, accent, action }: { title: string; children: React.ReactNode; accent?: boolean; action?: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className={`text-[13px] font-semibold uppercase tracking-[0.12em] ${accent ? "text-sindoor" : "text-muted"}`}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function AddWish({ view, lang, onClose, onSaved }: { view: View; lang: Lang; onClose: () => void; onSaved: (v: View) => void }) {
  const t = dict[lang];
  const family = view.households.find((h) => h.id === view.me.householdId)?.name ?? "";
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [priv, setPriv] = useState(false);
  const [saving, setSaving] = useState(false);
  const can = picked.length > 0 || note.trim().length > 0;

  async function save() {
    setSaving(true);
    try {
      const { view: v } = await api<{ view: View }>("/api/priorities", { body: { weddingId: view.wedding.id, priorities: picked, note, visibility: priv ? "household" : "shared" } });
      haptic.success();
      onSaved(v);
    } catch {
      haptic.error();
      setSaving(false);
    }
  }
  useMainButton(t.addPriority, save, { enabled: can, loading: saving });
  useBackButton(onClose);

  return (
    <main className="step-enter mx-auto w-full max-w-md px-5 pb-28 pt-6">
      <h1 className="mb-2 font-display text-[28px] leading-tight">{t.prioritiesTitle}</h1>
      <p className="mb-6 text-[15px] text-muted">{t.prioritiesHint}</p>
      <div className="mb-6 flex flex-wrap gap-2.5">
        {PRIORITY_KEYS.map((k) => (
          <Chip key={k} selected={picked.includes(k)} onToggle={() => setPicked((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]))}>
            {t.priorityPresets[k]}
          </Chip>
        ))}
      </div>
      <Field label={t.noteLabel}>
        <textarea className={`${inputClass} min-h-24 resize-none`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} />
      </Field>
      <button type="button" onClick={() => { haptic.select(); setPriv((v) => !v); }} className="pressable flex w-full items-center justify-between py-2 text-left">
        <PrivacyNote privateTone={priv}>{priv ? t.visibilityHousehold(family) : t.visibilityShared}</PrivacyNote>
        <span className={`relative h-7 w-12 rounded-full transition-colors duration-200 ${priv ? "bg-mehendi" : "bg-line"}`}>
          <span className="absolute top-1 left-1 size-5 rounded-full bg-white shadow" style={{ transform: `translateX(${priv ? 20 : 0}px)`, transition: "transform 200ms var(--ease-out)" }} />
        </span>
      </button>
      <button type="button" onClick={onClose} className="mt-4 text-sm text-muted">{t.back}</button>
      <FallbackButton text={t.addPriority} onClick={save} enabled={can} loading={saving} />
    </main>
  );
}
