"use client";
import { useCallback, useState } from "react";
import { LANGS, dict, type Lang } from "@/lib/i18n";
import { BigChoice, Question } from "@/components/ui";

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

export function LanguageStep({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const t = dict[lang];
  return (
    <>
      <div className="mb-6 text-4xl" aria-hidden>🌼</div>
      <Question title={t.chooseLanguage} hint={t.chooseLanguageHint} />
      <div className="flex flex-col gap-3">
        {LANGS.map((l) => (
          <BigChoice key={l.code} selected={lang === l.code} onClick={() => setLang(l.code)} title={l.label} subtitle={l.hint} />
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
