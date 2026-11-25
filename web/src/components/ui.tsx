"use client";
import { useMemo, type ReactNode } from "react";
import { haptic, useWebApp } from "@/lib/client/telegram";

export function Screen({ children, dir = "forward", stepKey }: { children: ReactNode; dir?: "forward" | "back"; stepKey: string }) {
  return (
    <main key={stepKey} data-dir={dir} className="step-enter mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-28 pt-6">
      {children}
    </main>
  );
}

export function Progress({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-8 flex gap-1.5" aria-label={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-marigold"
            style={{ transform: `scaleX(${i < step ? 1 : 0})`, transformOrigin: "left", transition: "transform 300ms var(--ease-out)" }}
          />
        </div>
      ))}
    </div>
  );
}

export function Question({ title, hint }: { title: string; hint?: string }) {
  return (
    <header className="mb-7">
      <h1 className="font-display text-[28px] leading-tight tracking-tight">{title}</h1>
      {hint ? <p className="mt-2 text-[15px] text-muted">{hint}</p> : null}
    </header>
  );
}

export function Field({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-[13px] font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
      {note ? <span className="mt-1.5 block text-[13px] text-muted">{note}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-2xl border border-line bg-card px-4 py-3.5 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted/70 focus:border-marigold focus:shadow-[0_0_0_4px_var(--marigold-soft)]";

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
        selected ? "border-marigold bg-marigold-soft font-medium" : "border-line bg-card"
      }`}
    >
      {selected ? <span className="mr-1.5 text-marigold">✓</span> : null}
      {children}
    </button>
  );
}

export function BigChoice({ selected, onClick, title, subtitle }: { selected?: boolean; onClick: () => void; title: string; subtitle?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.select();
        onClick();
      }}
      className={`pressable flex min-h-16 w-full items-center justify-between rounded-2xl border px-5 py-4 text-left ${
        selected ? "border-marigold bg-marigold-soft" : "border-line bg-card"
      }`}
    >
      <span>
        <span className="block text-xl font-medium">{title}</span>
        {subtitle ? <span className="block text-sm text-muted">{subtitle}</span> : null}
      </span>
      <span
        className={`grid size-6 place-items-center rounded-full border-2 transition-colors duration-150 ${selected ? "border-marigold bg-marigold text-white" : "border-line"}`}
      >
        {selected ? "✓" : ""}
      </span>
    </button>
  );
}

/** Rendered only outside Telegram, where there's no native MainButton. */
export function FallbackButton({ text, onClick, enabled = true, loading = false }: { text: string; onClick: () => void; enabled?: boolean; loading?: boolean }) {
  const wa = useWebApp();
  if (wa) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 bg-gradient-to-t from-bg via-bg to-transparent px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-6">
      <button
        type="button"
        disabled={!enabled || loading}
        onClick={onClick}
        className="pressable mx-auto block min-h-14 w-full max-w-md rounded-2xl bg-marigold text-[17px] font-semibold text-[#2a1f14] shadow-[0_8px_24px_-8px_var(--marigold)] disabled:opacity-40"
      >
        {loading ? "…" : text}
      </button>
    </div>
  );
}

export function PrivacyNote({ children, privateTone = false }: { children: ReactNode; privateTone?: boolean }) {
  return (
    <p className={`mt-1 flex items-center gap-2 text-[13px] ${privateTone ? "text-mehendi" : "text-muted"}`}>
      <span aria-hidden>{privateTone ? "🔒" : "👥"}</span>
      {children}
    </p>
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
