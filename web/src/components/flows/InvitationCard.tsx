import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import { VivaahMark } from "@/components/landing/BrandIcons";

export function formatDate(date: string | null, lang: Lang) {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  const opts = { day: "numeric", month: "long", year: "numeric" } as const;
  try {
    return d.toLocaleDateString(lang === "od" ? "or-IN" : `${lang}-IN`, opts);
  } catch {
    return d.toLocaleDateString("en-IN", opts);
  }
}

function Corner({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden className={`absolute text-marigold ${className}`}>
      <path d="M2 38V14C2 7.4 7.4 2 14 2h24" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 38V18c0-5.5 4.5-10 10-10h20" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <circle cx="14" cy="14" r="2.4" fill="var(--sindoor)" />
    </svg>
  );
}

/**
 * The wedding as invitation stock: a gold hairline frame inside the card, the couple's
 * names large, the families underneath. Every screen orbits this object.
 */
export function InvitationCard({
  couple,
  date,
  city,
  lang,
  families,
  footer,
}: {
  couple: string;
  date: string | null;
  city: string | null;
  lang: Lang;
  families?: [string, string];
  footer?: ReactNode;
}) {
  const [a, b] = couple.split(" & ");
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-marigold/40 bg-card p-2.5 shadow-[0_24px_60px_-30px_rgba(179,38,30,0.45)]">
      <div className="relative rounded-[20px] border border-marigold/35 px-6 pb-7 pt-8 text-center">
        <Corner className="left-1.5 top-1.5" />
        <Corner className="right-1.5 top-1.5 rotate-90" />
        <Corner className="bottom-1.5 right-1.5 rotate-180" />
        <Corner className="bottom-1.5 left-1.5 -rotate-90" />

        <div className="mb-4 flex justify-center">
          <VivaahMark size={34} />
        </div>
        <p className="font-display text-[38px] leading-[1.05]">{a}</p>
        <p className="my-1 font-display text-[22px] italic text-sindoor">&amp;</p>
        <p className="font-display text-[38px] leading-[1.05]">{b}</p>

        {date || city ? (
          <p className="mt-5 text-[15px] text-body">{[formatDate(date, lang), city].filter(Boolean).join(" · ")}</p>
        ) : null}
        {families ? (
          <p className="mt-3 flex items-center justify-center gap-2 text-[13px] text-muted">
            <span>{families[0]}</span>
            <span aria-hidden className="text-marigold">✦</span>
            <span>{families[1]}</span>
          </p>
        ) : null}
        {footer ? <p className="mt-5 inline-block rounded-full bg-marigold-soft px-4 py-1.5 text-[14px] font-medium">{footer}</p> : null}
      </div>
    </div>
  );
}
