"use client";
import { useState } from "react";
import { dict, type Lang } from "@/lib/i18n";
import { api, haptic, useBackButton, useMainButton } from "@/lib/client/telegram";
import { Chip, FallbackButton, Field, PrivacyNote, Progress, Question, Screen, formatINR, formatLakh, inputClass } from "@/components/ui";
import { LanguageStep, useSteps } from "./shared";
import type { View } from "./types";

const FUNCTIONS = [
  { kind: "engagement", label: "Engagement", emoji: "💍" },
  { kind: "haldi", label: "Haldi", emoji: "🌼" },
  { kind: "mehendi", label: "Mehendi", emoji: "🌿" },
  { kind: "sangeet", label: "Sangeet", emoji: "🎶" },
  { kind: "ceremony", label: "Ceremony", emoji: "🔥" },
  { kind: "reception", label: "Reception", emoji: "✨" },
];
const GUEST_PRESETS = [100, 200, 350, 500, 800];
const BUDGET_PRESETS = [500000, 1000000, 1500000, 2500000, 5000000];

export function CreateFlow({ lang, setLang, firstName, onDone }: { lang: Lang; setLang: (l: Lang) => void; firstName: string; onDone: (v: View) => void }) {
  const t = dict[lang];
  const TOTAL = 6;
  const { step, dir, next, back } = useSteps(TOTAL);

  const [partnerA, setPartnerA] = useState("");
  const [partnerB, setPartnerB] = useState("");
  const [date, setDate] = useState("");
  const [city, setCity] = useState("");
  const [functions, setFunctions] = useState<string[]>(["sangeet", "ceremony", "reception"]);
  const [guests, setGuests] = useState<number | null>(350);
  const [budget, setBudget] = useState<number | null>(1500000);
  const [myFamily, setMyFamily] = useState("");
  const [otherFamily, setOtherFamily] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = [
    true,
    partnerA.trim().length > 0 && partnerB.trim().length > 0,
    true,
    functions.length > 0,
    true,
    myFamily.trim().length > 0 && otherFamily.trim().length > 0,
  ][step];
  const isLast = step === TOTAL - 1;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const { view } = await api<{ view: View }>("/api/weddings", {
        body: { partnerA, partnerB, weddingDate: date || null, city, functions, guestCount: guests, budgetInr: budget, myFamily, otherFamily, displayName: firstName, language: lang },
      });
      haptic.success();
      onDone(view);
    } catch (e) {
      haptic.error();
      setError(String((e as Error).message));
      setSaving(false);
    }
  }

  const primary = isLast ? t.createCta : t.continue;
  const onPrimary = isLast ? submit : next;
  useMainButton(primary, onPrimary, { enabled: canContinue, loading: saving });
  useBackButton(step > 0 ? back : null);

  return (
    <Screen stepKey={`c${step}`} dir={dir}>
      {step > 0 ? <Progress step={step} total={TOTAL - 1} /> : null}

      {step === 0 && <LanguageStep lang={lang} setLang={setLang} />}

      {step === 1 && (
        <>
          <Question title={t.coupleTitle} hint={t.coupleHint} />
          <Field label={t.partnerA}>
            <input className={inputClass} value={partnerA} onChange={(e) => setPartnerA(e.target.value)} placeholder="Meera" autoComplete="off" />
          </Field>
          <div className="-mt-1 mb-3 text-center font-display text-[28px] italic text-sindoor" aria-hidden>&amp;</div>
          <Field label={t.partnerB}>
            <input className={inputClass} value={partnerB} onChange={(e) => setPartnerB(e.target.value)} placeholder="Aarav" autoComplete="off" />
          </Field>
        </>
      )}

      {step === 2 && (
        <>
          <Question title={t.whenWhereTitle} hint={t.whenWhereHint} />
          <Field label={t.date}>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t.city}>
            <input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Pune" />
          </Field>
        </>
      )}

      {step === 3 && (
        <>
          <Question title={t.functionsTitle} hint={t.functionsHint} />
          <div className="flex flex-wrap gap-2.5">
            {FUNCTIONS.map((f) => (
              <Chip
                key={f.kind}
                selected={functions.includes(f.kind)}
                onToggle={() => setFunctions((xs) => (xs.includes(f.kind) ? xs.filter((x) => x !== f.kind) : [...xs, f.kind]))}
              >
                <span className="mr-1" aria-hidden>{f.emoji}</span>
                {f.label}
              </Chip>
            ))}
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <Question title={t.sizeTitle} />
          <Field label={t.guests}>
            <div className="mb-3 flex flex-wrap gap-2">
              {GUEST_PRESETS.map((g) => (
                <Chip key={g} selected={guests === g} onToggle={() => setGuests(g)}>
                  {g}
                </Chip>
              ))}
            </div>
            <input
              inputMode="numeric"
              className={inputClass}
              value={guests ?? ""}
              onChange={(e) => setGuests(e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null)}
            />
          </Field>
          <Field label={t.budget} note={<PrivacyNote privateTone>{t.budgetPrivate}</PrivacyNote>}>
            <div className="mb-3 flex flex-wrap gap-2">
              {BUDGET_PRESETS.map((b) => (
                <Chip key={b} selected={budget === b} onToggle={() => setBudget(b)}>
                  {formatLakh(b)}
                </Chip>
              ))}
            </div>
            <input
              inputMode="numeric"
              className={inputClass}
              value={budget != null ? formatINR(budget) : ""}
              onChange={(e) => {
                const n = e.target.value.replace(/\D/g, "");
                setBudget(n ? Number(n) : null);
              }}
            />
          </Field>
        </>
      )}

      {step === 5 && (
        <>
          <Question title={t.familiesTitle} hint={t.familiesHint} />
          <Field label={t.yourFamily}>
            <input className={inputClass} value={myFamily} onChange={(e) => setMyFamily(e.target.value)} placeholder={t.familyPlaceholderA} />
          </Field>
          <Field label={t.otherFamily}>
            <input className={inputClass} value={otherFamily} onChange={(e) => setOtherFamily(e.target.value)} placeholder={t.familyPlaceholderB} />
          </Field>
          {error ? <p className="mt-2 text-sm text-sindoor">{error}</p> : null}
        </>
      )}

      <FallbackButton text={primary} onClick={onPrimary} enabled={canContinue} loading={saving} />
    </Screen>
  );
}
