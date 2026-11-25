"use client";
import { useCallback, useEffect, useState } from "react";

interface Data {
  guest: { name: string; party: number };
  wedding: { partner_a: string; partner_b: string; wedding_date: string | null; city: string | null } | null;
  functions: { id: string; title: string; on_date: string | null; starts_at: string | null; venue: string | null }[];
  rsvps: { function_id: string; attending: boolean; people: number; veg: number }[];
  registry: { id: string; title: string; price_inr: number | null; state: "mine" | "taken" | "free" }[];
}

const inr = (n: number | null) => (n == null ? "" : `₹${n.toLocaleString("en-IN")}`);

/** Guest page: RSVP per function and reserve a gift. A guest sees only their own answers. */
export function GuestPage({ token }: { token: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const call = useCallback(async (body?: object) => {
    const r = await fetch(`/api/rsvp/${token}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "error");
    setD(j);
  }, [token]);
  useEffect(() => {
    const t = setTimeout(() => call().catch((e) => setErr(e.message)), 0);
    return () => clearTimeout(t);
  }, [call]);
  const act = async (key: string, body: object) => {
    setBusy(key); setErr(null);
    try { await call(body); } catch (e) { setErr((e as Error).message === "already_reserved" ? "Someone just reserved that gift. Please pick another." : (e as Error).message); await call().catch(() => {}); }
    setBusy(null);
  };
  if (!d) return <main className="mx-auto max-w-md p-6">{err ? <p>This invitation link didn’t work.</p> : <div className="h-40 animate-pulse rounded-3xl bg-card" />}</main>;
  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pb-20 pt-8">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-sindoor">You’re invited</p>
      <h1 className="mt-1 font-display text-[34px] leading-tight">{d.wedding?.partner_a} &amp; {d.wedding?.partner_b}</h1>
      <p className="text-muted">{[d.wedding?.wedding_date, d.wedding?.city].filter(Boolean).join(" · ")}</p>
      <p className="mt-4 text-[17px]">Namaste {d.guest.name} 🙏 Which functions can you come to? ({d.guest.party} {d.guest.party === 1 ? "person" : "people"})</p>
      <ul className="mt-4 flex flex-col gap-3">
        {d.functions.map((f) => {
          const r = d.rsvps.find((x) => x.function_id === f.id);
          return (
            <li key={f.id} className="rounded-2xl border border-line bg-card p-4">
              <p className="font-display text-[20px]">{f.title}</p>
              <p className="text-[13px] text-muted">{[f.on_date, f.starts_at?.slice(0, 5), f.venue].filter(Boolean).join(" · ") || "Details coming soon"}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button disabled={busy !== null} onClick={() => act(f.id + "y", { functionId: f.id, attending: true, people: r?.people || d.guest.party, veg: r?.veg ?? 0 })} className={`pressable min-h-11 rounded-xl border text-[15px] font-medium ${r?.attending ? "border-mehendi bg-mehendi text-white" : "border-line"}`}>Coming</button>
                <button disabled={busy !== null} onClick={() => act(f.id + "n", { functionId: f.id, attending: false })} className={`pressable min-h-11 rounded-xl border text-[15px] font-medium ${r && !r.attending ? "border-sindoor bg-sindoor text-white" : "border-line"}`}>Can’t come</button>
              </div>
              {r?.attending ? (
                <label className="mt-3 flex items-center justify-between gap-3 text-[14px]">
                  Vegetarian meals
                  <select className="rounded-lg border border-line bg-card px-2 py-1.5" value={r.veg} onChange={(e) => act(f.id + "v", { functionId: f.id, attending: true, people: r.people, veg: Number(e.target.value) })}>
                    {Array.from({ length: r.people + 1 }, (_, i) => <option key={i} value={i}>{i} of {r.people}</option>)}
                  </select>
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
      {d.registry.length ? (
        <>
          <h2 className="mt-8 font-display text-[24px]">Gift registry</h2>
          <p className="text-[13px] text-muted">Only you and the family can see what you reserve.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {d.registry.map((i) => (
              <li key={i.id} className="flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3">
                <span className="flex-1">{i.title} <span className="text-muted">{inr(i.price_inr)}</span></span>
                {i.state === "free" ? <button disabled={busy !== null} onClick={() => act(i.id, { reserve: i.id })} className="pressable rounded-xl bg-sindoor px-3 py-2 text-[14px] font-semibold text-white">Reserve</button> : <span className="text-[14px] text-muted">{i.state === "mine" ? "✓ Yours" : "Taken"}</span>}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {err ? <p className="mt-4 text-sindoor">{err}</p> : null}
    </main>
  );
}
