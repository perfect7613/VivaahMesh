"use client";
import { useEffect, useState } from "react";

interface Data {
  vendor: { name: string; category: string; status: string; runSheet: string | null };
  wedding: { partner_a: string; partner_b: string; wedding_date: string | null; city: string | null } | null;
  functions: { kind: string; title: string; on_date: string | null; starts_at: string | null; venue: string | null; timeline: { title: string; start: number; end: number }[] }[];
}
const clock = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${m >= 720 && m < 1440 ? "pm" : "am"}`;

/** A vendor's run sheet: only their functions and the couple-approved timeline. No budgets, no other vendors. */
export function VendorPage({ token }: { token: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    fetch(`/api/vendor/${token}`).then(async (r) => (r.ok ? setD(await r.json()) : setBad(true))).catch(() => setBad(true));
  }, [token]);
  if (!d) return <main className="mx-auto max-w-md p-6">{bad ? "This run sheet link didn’t work." : <div className="h-40 animate-pulse rounded-3xl bg-card" />}</main>;
  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pb-20 pt-8">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-sindoor">Run sheet · {d.vendor.name}</p>
      <h1 className="mt-1 font-display text-[30px] leading-tight">{d.wedding?.partner_a} &amp; {d.wedding?.partner_b}</h1>
      <p className="text-muted">{[d.wedding?.wedding_date, d.wedding?.city].filter(Boolean).join(" · ")} · booking {d.vendor.status}</p>
      {d.functions.length === 0 ? <p className="mt-6">No functions assigned to you yet.</p> : null}
      {d.functions.map((f) => (
        <section key={f.kind + f.title} className="mt-5 rounded-2xl border border-line bg-card p-4">
          <h2 className="font-display text-[22px]">{f.title}</h2>
          <p className="text-[13px] text-muted">{[f.on_date, f.starts_at?.slice(0, 5), f.venue].filter(Boolean).join(" · ") || "Details to follow"}</p>
          {f.timeline.length ? (
            <ol className="mt-3 flex flex-col gap-1.5 text-[15px]">
              {[...f.timeline].sort((a, b) => a.start - b.start).map((x, i) => <li key={i} className="flex gap-3"><span className="w-36 shrink-0 tabular-nums text-muted">{clock(x.start)} – {clock(x.end)}</span>{x.title}</li>)}
            </ol>
          ) : <p className="mt-2 text-[14px] text-muted">The timeline appears here once the couple approves it.</p>}
        </section>
      ))}
      {d.vendor.runSheet ? <section className="mt-5 rounded-2xl border border-line p-4"><h2 className="font-medium">Notes from the family</h2><p className="mt-1 whitespace-pre-wrap text-[15px]">{d.vendor.runSheet}</p></section> : null}
    </main>
  );
}
