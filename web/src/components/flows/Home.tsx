"use client";
import { useState, type ReactNode } from "react";
import { tr, pickLang, type Lang } from "@/lib/i18n";
import { api, haptic, useBackButton, useMainButton } from "@/lib/client/telegram";
import { Chip, FallbackButton, Field, Petals, PrivacySwitch, inputClass, formatINR } from "@/components/ui";
import { TelegramIcon, WhatsAppIcon } from "@/components/landing/BrandIcons";
import { InvitationCard, formatDate } from "./InvitationCard";
import { FunctionSheet } from "./FunctionSheet";
import { PlanCard } from "./PlanCard";
import { CallScreen } from "./CallScreen";
import { AgentFeed } from "./AgentFeed";
import { inviteLink, shareInvite } from "./shared";
import type { View } from "./types";

const FN_EMOJI: Record<string, string> = { engagement: "💍", haldi: "🌼", mehendi: "🌿", sangeet: "🎶", ceremony: "🔥", reception: "✨", other: "🎉" };
const PRIORITY_KEYS = ["elders_dinner", "pure_veg", "muhurat", "dance", "accessibility", "budget_care", "music_late", "photos"];

function daysUntil(date: string | null) {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime();
  return Math.max(0, Math.round(d / 86400000));
}

export function Home({ view, setView, botUsername, celebrate, initialScreen }: { view: View; setView: (v: View) => void; botUsername: string; celebrate: "created" | "joined" | null; initialScreen?: "call" }) {
  const lang: Lang = pickLang(view.me.language);
  const t = tr(lang);
  const on = view.flags.on;
  const [adding, setAdding] = useState(false);
  const [editingFn, setEditingFn] = useState<View["functions"][number] | "new" | null>(null);
  const canEdit = view.me.isCouple || view.me.role === "parent";
  const [calling, setCalling] = useState(initialScreen === "call" && (view.me.isCouple || view.me.role === "parent"));
  const [copied, setCopied] = useState<string | null>(null);
  const couple = `${view.wedding.partnerA} & ${view.wedding.partnerB}`;
  const myHousehold = view.households.find((h) => h.id === view.me.householdId);
  const other = view.households.find((h) => h.id !== view.me.householdId);
  const famA = view.households.find((h) => h.side === "A")?.name ?? "";
  const famB = view.households.find((h) => h.side === "B")?.name ?? "";
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

  if (editingFn) {
    return (
      <FunctionSheet
        view={view}
        fn={editingFn === "new" ? null : editingFn}
        lang={lang}
        onClose={() => setEditingFn(null)}
        onSaved={(v) => {
          setView(v);
          setEditingFn(null);
        }}
      />
    );
  }
  if (calling) return <CallScreen view={view} lang={lang} onClose={() => setCalling(false)} />;
  if (adding) {
    return <AddWish view={view} lang={lang} onClose={() => setAdding(false)} onSaved={(v) => { setView(v); setAdding(false); }} />;
  }

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div className="toran" />
      <div aria-hidden className="pointer-events-none absolute -right-32 -top-16 size-[460px] rounded-full bg-[radial-gradient(circle,rgba(232,163,23,0.22),transparent_65%)]" />
      {celebrate && on.onboarding_celebration ? <Petals /> : null}

      <main className="relative mx-auto w-full max-w-md px-5 pb-16 pt-5">
        <div className="rise flex flex-col gap-7">
          <section>
            <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.18em] text-sindoor">{myHousehold?.name}</p>
            <h1 className="mb-5 font-display text-[30px] leading-tight">
              {celebrate === "created" ? t.createdTitle : celebrate === "joined" ? t.welcomeTitle(view.me.displayName) : t.hello(view.me.displayName)}
            </h1>
            {celebrate === "created" ? <p className="-mt-3 mb-5 text-[15px] leading-relaxed text-body">{t.createdHint}</p> : null}
            <InvitationCard
              couple={couple}
              date={view.wedding.date}
              city={view.wedding.city}
              lang={lang}
              families={[famA, famB]}
              footer={days != null ? t.daysToGo(days) : t.dateTbd}
            />
          </section>

          {tasks.length ? (
            <Section title={t.needsYou} tone="sindoor">
              <ul className="flex flex-col gap-2.5">
                {tasks.map((task) => (
                  <li key={task.key}>
                    <button
                      type="button"
                      onClick={task.action}
                      className="pressable flex min-h-16 w-full items-center gap-3 rounded-3xl border border-marigold/50 bg-marigold-soft px-5 py-3 text-left shadow-[0_12px_28px_-20px_var(--marigold)]"
                    >
                      <span className="size-2.5 shrink-0 rounded-full bg-sindoor" aria-hidden />
                      <span className="flex-1 text-[16px] font-medium">{copied === task.key ? "✓ Link copied" : task.label}</span>
                      <span aria-hidden className="text-xl text-muted">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title={t.families}>
            <div className="grid grid-cols-2 gap-3">
              {view.households.map((h) => (
                <div key={h.id} className={`flex flex-col rounded-3xl border bg-card p-4 ${h.id === view.me.householdId ? "border-marigold/50" : "border-line"}`}>
                  <span className="mb-3 grid size-11 place-items-center rounded-full bg-marigold-soft font-display text-[20px]" aria-hidden>
                    {h.name.slice(0, 1)}
                  </span>
                  <p className="font-medium leading-snug">{h.name}</p>
                  <p className="mb-3 text-[13px] text-muted">{h.members.length ? t.joined(h.members.length) : t.waitingToJoin}</p>
                  {h.members.length ? (
                    <div className="mb-3 flex -space-x-2">
                      {h.members.slice(0, 5).map((m) => (
                        <span key={m.id} title={m.name} className="grid size-8 place-items-center rounded-full border-2 border-card bg-[#f3e6cc] text-[13px] font-semibold text-ink">
                          {m.name.slice(0, 1).toUpperCase()}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {h.inviteCode ? (
                    <button type="button" onClick={() => invite(h.inviteCode!, h.name, h.id)} className="pressable mt-auto min-h-10 rounded-xl border border-line text-[14px] font-medium">
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
            <ul className="overflow-hidden rounded-3xl border border-line bg-card">
              {view.functions.map((f, i) => {
                const when = [f.on_date ? formatDate(f.on_date, lang) : null, f.starts_at?.slice(0, 5)].filter(Boolean).join(" · ");
                return (
                  <li key={f.id} className={i ? "border-t border-line" : ""}>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setEditingFn(f)}
                      className="pressable flex w-full items-center gap-3 px-5 py-4 text-left disabled:active:scale-100"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-marigold-soft text-lg" aria-hidden>{FN_EMOJI[f.kind] ?? "🎉"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-[19px]">{f.title}</span>
                        <span className="block truncate text-[13px] text-muted">
                          {[when, f.venue].filter(Boolean).join(" · ") || (canEdit ? t.tapToAddDetails : "—")}
                        </span>
                        {f.details ? <span className="mt-0.5 block truncate text-[13px] text-body">{f.details}</span> : null}
                      </span>
                      {canEdit ? <span aria-hidden className="text-xl text-muted">›</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {canEdit ? (
              <button type="button" onClick={() => setEditingFn("new")} className="pressable mt-3 min-h-12 w-full rounded-2xl border border-dashed border-marigold/60 text-[15px] font-medium">
                ＋ {t.addFunction}
              </button>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
              {view.me.isCouple && view.wedding.guestCount ? <span>👥 {view.wedding.guestCount}</span> : null}
              {view.me.isCouple && view.wedding.budgetInr ? <span>🔒 {formatINR(view.wedding.budgetInr)}</span> : null}
              {/* Flagsmith remote config, shown so families know why options are ordered the way they are. */}
              <span title={`compiler_policy ${view.flags.policy.version} · ${view.flags.source}`}>
                ⚖️ {t.plannerSetting}: <span className="text-body">{t.strategies[view.flags.policy.strategy] ?? view.flags.policy.strategy}</span>
              </span>
            </div>
          </Section>

          <Section title={t.planCheck} tone="sindoor">
            <PlanCard view={view} lang={lang} onCallVenue={() => setCalling(true)} />
          </Section>

          {on.home_team_section ? (
            <Section title={t.teamHandling}>
              <AgentFeed weddingId={view.wedding.id} lang={lang} />
            </Section>
          ) : null}


          <Section
            title={t.priorities}
            action={
              <button type="button" onClick={() => setAdding(true)} className="pressable rounded-full border border-marigold/50 px-3 py-1 text-[13px] font-medium text-sindoor">
                ＋ {t.addPriority}
              </button>
            }
          >
            {view.priorities.length ? (
              <ul className="flex flex-col gap-2.5">
                {view.priorities.map((p) => (
                  <li key={p.id} className="rounded-3xl border border-line bg-card px-5 py-4">
                    <p className="text-[16px] leading-snug">{p.kind === "note" ? p.note : t.priorityPresets[p.kind] ?? p.kind}</p>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[12.5px]">
                      <span className="text-mehendi">
                        {t.sharedBy(p.author, p.family)}
                        {p.source === "telegram" ? " · Telegram" : p.source === "whatsapp" ? " · WhatsApp" : p.source === "voice" ? " · 🎙️" : ""}
                      </span>
                      <span className={p.visibility === "household" ? "text-mehendi" : "text-muted"}>
                        {p.visibility === "household" ? `🔒 ${t.private}` : `👥 ${t.shared}`}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          <Section title={t.channels}>
            <ul className="overflow-hidden rounded-3xl border border-line bg-card">
              <Channel icon={<TelegramIcon size={22} className="text-[#229ED9]" />} label={t.channelTelegram} badge={t.channelHere} />
              {on.whatsapp_bridge_enabled ? (
                <Channel icon={<WhatsAppIcon size={22} className="text-[#25D366]" />} label={t.channelWhatsApp} badge={t.beta} border />
              ) : null}
            </ul>
          </Section>
        </div>
      </main>
    </div>
  );
}

function Channel({ icon, label, badge, border }: { icon: ReactNode; label: string; badge: string; border?: boolean }) {
  return (
    <li className={`flex items-center gap-3 px-5 py-4 ${border ? "border-t border-line" : ""}`}>
      <span className="grid size-10 place-items-center rounded-full bg-bg">{icon}</span>
      <span className="flex-1 text-[15px]">{label}</span>
      <span className="rounded-full bg-marigold-soft px-2.5 py-0.5 text-[12px] font-medium">{badge}</span>
    </li>
  );
}

function Section({ title, children, tone, action }: { title: string; children: ReactNode; tone?: "sindoor"; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className={`text-[12px] font-semibold uppercase tracking-[0.18em] ${tone === "sindoor" ? "text-sindoor" : "text-muted"}`}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function AddWish({ view, lang, onClose, onSaved }: { view: View; lang: Lang; onClose: () => void; onSaved: (v: View) => void }) {
  const t = tr(lang);
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
    <div className="relative min-h-dvh overflow-x-clip">
      <div className="toran" />
      <main className="step-enter relative mx-auto w-full max-w-md px-5 pb-32 pt-6">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-sindoor">{family}</p>
        <h1 className="mb-3 font-display text-[32px] leading-[1.08]">{t.prioritiesTitle}</h1>
        <p className="mb-7 text-[16px] leading-relaxed text-body">{t.prioritiesHint}</p>
        <div className="mb-7 flex flex-wrap gap-2.5">
          {PRIORITY_KEYS.map((k) => (
            <Chip key={k} selected={picked.includes(k)} onToggle={() => setPicked((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]))}>
              {t.priorityPresets[k]}
            </Chip>
          ))}
        </div>
        <Field label={t.noteLabel}>
          <textarea className={`${inputClass} min-h-28 resize-none`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} />
        </Field>
        <PrivacySwitch isPrivate={priv} onToggle={() => setPriv((v) => !v)} privateLabel={t.visibilityHousehold(family)} sharedLabel={t.visibilityShared} />
        <FallbackButton text={t.addPriority} onClick={save} enabled={can} loading={saving} />
      </main>
    </div>
  );
}
