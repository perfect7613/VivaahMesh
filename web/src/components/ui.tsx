"use client";
import { useMemo, type ReactNode } from "react";
import { haptic, useWebApp } from "@/lib/client/telegram";

/** One onboarding step. The toran and the warm glow are the same as the website's hero. */
export function Screen({ children, dir = "forward", stepKey }: { children: ReactNode; dir?: "forward" | "back"; stepKey: string }) {
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div className="toran" />
      <div aria-hidden className="pointer-events-none absolute -right-32 -top-20 size-[420px] rounded-full bg-[radial-gradient(circle,rgba(232,163,23,0.22),transparent_65%)]" />
      <main key={stepKey} data-dir={dir} className="step-enter relative mx-auto flex w-full max-w-md flex-col px-5 pb-32 pt-6">
        {children}
      </main>
    </div>
  );
}

/** Progress as a string of marigolds: filled for done, outlined for what's left. */
export function Progress({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-8 flex items-center gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="flex flex-1 items-center gap-2">
          <span
            className={`size-3 shrink-0 rounded-full border-2 transition-[background-color,border-color,transform] duration-300 ${
              i < step ? "border-marigold bg-marigold" : "border-line bg-transparent"
            } ${i === step - 1 ? "scale-125" : ""}`}
            style={{ transitionTimingFunction: "var(--ease-out)" }}
          />
          {i < total - 1 ? <span className={`h-px flex-1 ${i < step - 1 ? "bg-marigold/60" : "bg-line"}`} /> : null}
        </span>
      ))}
    </div>
  );
}

export function Question({ eyebrow, title, hint }: { eyebrow?: string; title: string; hint?: string }) {
  return (
    <header className="mb-7">
      {eyebrow ? <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-sindoor">{eyebrow}</p> : null}
      <h1 className="font-display text-[32px] leading-[1.08] tracking-tight">{title}</h1>
      {hint ? <p className="mt-3 text-[16px] leading-relaxed text-body">{hint}</p> : null}
    </header>
  );
}

export function Field({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <label className="mb-5 block">
      <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</span>
      {children}
      {note ? <span className="mt-2 block">{note}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-2xl border border-line bg-card px-4 py-3.5 text-[17px] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted/70 focus:border-marigold focus:shadow-[0_0_0_4px_var(--marigold-soft)]";

export function Chip({ selected, onToggle, children }: { selected: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        haptic.select();
        onToggle();
      }}
      className={`pressable min-h-12 rounded-full border px-4 py-2.5 text-[15px] ${
        selected ? "border-marigold bg-marigold-soft font-medium shadow-[0_6px_16px_-10px_var(--marigold)]" : "border-line bg-card"
      }`}
    >
      {selected ? <span className="mr-1.5 text-sindoor">✓</span> : null}
      {children}
    </button>
  );
}

export function BigChoice({ selected, onClick, title, subtitle, sample }: { selected?: boolean; onClick: () => void; title: string; subtitle?: string; sample?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.select();
        onClick();
      }}
      className={`pressable flex min-h-20 w-full items-center justify-between gap-4 rounded-3xl border px-5 py-4 text-left ${
        selected ? "border-marigold bg-marigold-soft shadow-[0_12px_28px_-18px_var(--marigold)]" : "border-line bg-card"
      }`}
    >
      <span className="min-w-0">
        <span className="block font-display text-[24px] leading-tight">{title}</span>
        {sample ? <span className="mt-0.5 block truncate text-[14px] text-body">{sample}</span> : null}
        {subtitle ? <span className="block text-[12px] uppercase tracking-[0.12em] text-muted">{subtitle}</span> : null}
      </span>
      <span
        className={`grid size-7 shrink-0 place-items-center rounded-full border-2 text-sm transition-colors duration-150 ${selected ? "border-sindoor bg-sindoor text-white" : "border-line"}`}
      >
        {selected ? "✓" : ""}
      </span>
    </button>
  );
}

/** Rendered only outside Telegram, where there's no native MainButton. Same look as the website's CTA. */
export function FallbackButton({ text, onClick, enabled = true, loading = false }: { text: string; onClick: () => void; enabled?: boolean; loading?: boolean }) {
  const wa = useWebApp();
  if (wa) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 bg-gradient-to-t from-bg via-bg/95 to-transparent px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-8">
      <button
        type="button"
        disabled={!enabled || loading}
        onClick={onClick}
        className="pressable mx-auto block min-h-14 w-full max-w-md rounded-2xl bg-sindoor text-[17px] font-semibold text-white shadow-[0_14px_30px_-14px_var(--sindoor)] disabled:opacity-40"
      >
        {loading ? <span className="inline-block size-5 animate-spin rounded-full border-2 border-white/40 border-t-white align-middle" /> : text}
      </button>
    </div>
  );
}

export function PrivacyNote({ children, privateTone = false }: { children: ReactNode; privateTone?: boolean }) {
  return (
    <span className={`flex items-center gap-2 text-[13px] ${privateTone ? "text-mehendi" : "text-muted"}`}>
      <span aria-hidden>{privateTone ? "🔒" : "👥"}</span>
      {children}
    </span>
  );
}

/** Two-state switch for private/shared, used wherever a family adds something. */
export function PrivacySwitch({ isPrivate, onToggle, privateLabel, sharedLabel }: { isPrivate: boolean; onToggle: () => void; privateLabel: string; sharedLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isPrivate}
      onClick={() => {
        haptic.select();
        onToggle();
      }}
      className="pressable flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-left"
    >
      <PrivacyNote privateTone={isPrivate}>{isPrivate ? privateLabel : sharedLabel}</PrivacyNote>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${isPrivate ? "bg-mehendi" : "bg-line"}`}>
        <span
          className="absolute left-1 top-1 size-5 rounded-full bg-white shadow"
          style={{ transform: `translateX(${isPrivate ? 20 : 0}px)`, transition: "transform 200ms var(--ease-out)" }}
        />
      </span>
    </button>
  );
}

export function Petals({ count = 28 }: { count?: number }) {
  const petals = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(i * 37) % 100}%`,
        delay: `${(i % 7) * 60}ms`,
        dx: `${((i * 53) % 120) - 60}px`,
        rot: `${((i * 97) % 540) - 270}deg`,
        color: i % 3 === 0 ? "var(--sindoor)" : "var(--marigold)",
      })),
    [count],
  );
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-20 overflow-hidden">
      {petals.map((p, i) => (
        <span
          key={i}
          className="petal"
          style={{ left: p.left, animationDelay: p.delay, background: p.color, ["--dx" as string]: p.dx, ["--rot" as string]: p.rot }}
        />
      ))}
    </div>
  );
}

export function formatINR(n: number | null | undefined): string {
  if (n == null) return "";
  return "₹" + new Intl.NumberFormat("en-IN").format(n);
}

/** Compact Indian money for chips: ₹15L, ₹1.2Cr. */
export function formatLakh(n: number): string {
  if (n >= 10000000) return `₹${+(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${+(n / 100000).toFixed(1)}L`;
  return formatINR(n);
}
