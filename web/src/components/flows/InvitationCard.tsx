import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n";

const LOCALE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };

export function formatDate(date: string | null, lang: Lang) {
  if (!date) return null;
  return new Date(`${date}T00:00:00`).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long", year: "numeric" });
}

/** The wedding, presented like invitation stock: the one object every screen orbits. */
export function InvitationCard({ couple, date, city, lang, footer }: { couple: string; date: string | null; city: string | null; lang: Lang; footer?: ReactNode }) {
  const [a, b] = couple.split(" & ");
  return (
    <div className="relative overflow-hidden rounded-3xl border border-marigold/40 bg-card shadow-[0_20px_50px_-24px_rgba(179,38,30,0.35)]">
      <div className="toran" />
      <div className="px-6 pb-7 pt-8 text-center">
        <div className="mb-3 text-2xl" aria-hidden>🪔</div>
        <p className="font-display text-[34px] leading-tight">{a}</p>
        <p className="my-1 font-display text-xl text-marigold">&amp;</p>
        <p className="font-display text-[34px] leading-tight">{b}</p>
        {date || city ? (
          <p className="mt-4 text-[15px] text-muted">{[formatDate(date, lang), city].filter(Boolean).join(" · ")}</p>
        ) : null}
        {footer ? <p className="mt-5 inline-block rounded-full bg-marigold-soft px-4 py-1.5 text-sm font-medium">{footer}</p> : null}
      </div>
    </div>
  );
}
