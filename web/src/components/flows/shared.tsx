"use client";
import { useCallback, useState } from "react";
import { LANGS, tr, type Lang } from "@/lib/i18n";
import { haptic } from "@/lib/client/telegram";
import { BigChoice, Question } from "@/components/ui";
import { VivaahMark } from "@/components/landing/BrandIcons";

export function useSteps(total: number, onExit?: () => void) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const next = useCallback(() => {
    setDir("forward");
    setStep((s) => Math.min(s + 1, total - 1));
  }, [total]);
  const back = useCallback(() => {
    setDir("back");
    setStep((s) => {
      if (s === 0) {
        onExit?.();
        return s;
      }
      return s - 1;
    });
  }, [onExit]);
  return { step, dir, next, back, setStep };
}

// A line in each language, so people recognise their script before reading the label.
const SAMPLE: Record<string, string> = {
  mr: "नमस्कार! चला, लग्नाची तयारी करूया.",
  hi: "नमस्ते! चलिए, शादी की तैयारी करते हैं।",
  en: "Hello! Let's plan the wedding.",
};

export function LanguageStep({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const t = tr(lang);
  return (
    <>
      <div className="mb-6 flex justify-start">
        <VivaahMark size={44} />
      </div>
      <Question eyebrow="VivaahMesh" title={t.chooseLanguage} hint={t.chooseLanguageHint} />
      <div className="flex flex-col gap-3">
        {LANGS.filter((l) => SAMPLE[l.code]).map((l) => (
          <BigChoice key={l.code} selected={lang === l.code} onClick={() => setLang(l.code)} title={l.label} sample={SAMPLE[l.code]} subtitle={l.code === "en" ? undefined : l.hint} />
        ))}
      </div>
      {/* Every other language Sarvam supports. The app is translated into it the first time someone picks it. */}
      <p className="mb-3 mt-8 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">{t.moreLanguages}</p>
      <div className="grid grid-cols-2 gap-2.5">
        {LANGS.filter((l) => !SAMPLE[l.code]).map((l) => (
          <button
            key={l.code}
            type="button"
            dir={l.rtl ? "rtl" : undefined}
            onClick={() => {
              haptic.select();
              setLang(l.code);
            }}
            aria-pressed={lang === l.code}
            className={`pressable flex min-h-14 flex-col items-start justify-center rounded-2xl border px-4 py-2 text-left ${lang === l.code ? "border-marigold bg-marigold-soft" : "border-line bg-card"}`}
          >
            <span className="text-[17px] leading-tight">{l.label}</span>
            <span className="text-[11px] uppercase tracking-[0.1em] text-muted">{l.hint}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/** Shares an invite: Telegram's share sheet inside Telegram, the system share sheet or clipboard elsewhere. */
export async function shareInvite(url: string, text: string): Promise<"shared" | "copied"> {
  const wa = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
  if (wa?.initData) {
    wa.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
    return "shared";
  }
  if (navigator.share) {
    try {
      await navigator.share({ url, text });
      return "shared";
    } catch {
      /* cancelled: fall through to copy */
    }
  }
  await navigator.clipboard.writeText(`${text}\n${url}`);
  return "copied";
}

export function inviteLink(botUsername: string, code: string) {
  return `https://t.me/${botUsername}?start=join_${code}`;
}
