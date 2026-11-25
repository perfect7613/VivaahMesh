"use client";
import { useEffect, useState } from "react";
import { dict, type Lang } from "@/lib/i18n";
import { api, haptic, useBackButton, useMainButton } from "@/lib/client/telegram";
import { Chip, FallbackButton, Field, PrivacyNote, Progress, Question, Screen, inputClass } from "@/components/ui";
import { LanguageStep, useSteps } from "./shared";
import { InvitationCard } from "./InvitationCard";
import type { InvitePreview, View } from "./types";

const ROLE_KEYS = ["parent", "grandparent", "sibling", "cousin", "relative", "friend"];
const PRIORITY_KEYS = ["elders_dinner", "pure_veg", "muhurat", "dance", "accessibility", "budget_care", "music_late", "photos"];

export function JoinFlow({ code, lang, setLang, firstName, onDone }: { code: string; lang: Lang; setLang: (l: Lang) => void; firstName: string; onDone: (v: View) => void }) {
  const t = dict[lang];
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isCouple = preview?.kind === "couple";
  const TOTAL = 4; // language, invitation, who are you, priorities
  const { step, dir, next, back } = useSteps(TOTAL);

  const [name, setName] = useState(firstName);
  const [role, setRole] = useState<string>("");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [privateToFamily, setPrivateToFamily] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<InvitePreview>(`/api/invites/${encodeURIComponent(code)}`).then(setPreview, (e) => setLoadError(String(e.message)));
  }, [code]);

  const canContinue = [true, !!preview, name.trim().length > 0 && (isCouple || !!role), true][step];
  const isLast = step === TOTAL - 1;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const { view } = await api<{ view: View }>("/api/join", {
        body: { code, displayName: name, role: isCouple ? "couple" : role, language: lang, priorities: picked, note, visibility: privateToFamily ? "household" : "shared" },
      });
      haptic.success();
      onDone(view);
    } catch (e) {
      haptic.error();
      setError(String((e as Error).message));
      setSaving(false);
    }
  }

  const primary = step === 1 ? t.joinCta : isLast ? t.joinCta : t.continue;
  const onPrimary = isLast ? submit : next;
  useMainButton(primary, onPrimary, { enabled: canContinue, loading: saving });
  useBackButton(step > 0 ? back : null);

  if (loadError) {
    return (
      <Screen stepKey="err">
        <Question title="😕" hint={loadError === "invite_not_found" ? "This invite link doesn't work any more. Ask the family to send a fresh one." : loadError} />
      </Screen>
    );
  }

  const family = preview?.family ?? "";

  return (
    <Screen stepKey={`j${step}`} dir={dir}>
      {step > 1 ? <Progress step={step - 1} total={TOTAL - 2} /> : null}

      {step === 0 && <LanguageStep lang={lang} setLang={setLang} />}

      {step === 1 && (
        <div className="flex flex-1 flex-col justify-center">
          <p className="mb-4 text-center text-[13px] font-medium uppercase tracking-[0.2em] text-muted">{t.invitedTitle}</p>
          {preview ? (
            <InvitationCard couple={preview.couple} date={preview.date} city={preview.city} lang={lang} footer={isCouple ? null : t.joiningAs(family)} />
          ) : (
            <div className="h-72 animate-pulse rounded-3xl bg-card" />
          )}
        </div>
      )}

      {step === 2 && (
        <>
          <Question title={t.whoAreYouTitle} />
          <Field label={t.yourName}>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
          </Field>
          {!isCouple && (
            <Field label={t.yourRole}>
              <div className="flex flex-wrap gap-2.5">
                {ROLE_KEYS.map((r) => (
                  <Chip key={r} selected={role === r} onToggle={() => setRole(r)}>
                    {t.roles[r]}
                  </Chip>
                ))}
              </div>
            </Field>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <Question title={t.prioritiesTitle} hint={t.prioritiesHint} />
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
          <button
            type="button"
            onClick={() => {
              haptic.select();
              setPrivateToFamily((v) => !v);
            }}
            className="pressable -mx-1 flex w-full items-center justify-between rounded-2xl px-1 py-2 text-left"
          >
            <PrivacyNote privateTone={privateToFamily}>{privateToFamily ? t.visibilityHousehold(family) : t.visibilityShared}</PrivacyNote>
            <span className={`relative h-7 w-12 rounded-full transition-colors duration-200 ${privateToFamily ? "bg-mehendi" : "bg-line"}`}>
              <span
                className="absolute top-1 left-1 size-5 rounded-full bg-white shadow"
                style={{ transform: `translateX(${privateToFamily ? 20 : 0}px)`, transition: "transform 200ms var(--ease-out)" }}
              />
            </span>
          </button>
          {error ? <p className="mt-2 text-sm text-sindoor">{error}</p> : null}
        </>
      )}

      <FallbackButton text={primary} onClick={onPrimary} enabled={canContinue} loading={saving} />
    </Screen>
  );
}
