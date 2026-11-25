"use client";
import { useCallback, useEffect, useState } from "react";
import { api, haptic, useBackButton } from "@/lib/client/telegram";
import { useWeddingLive } from "@/lib/client/live";
import type { View } from "./types";

type L = {
  me: { id: string; isCouple: boolean; decider: boolean };
  stage: string;
  next: string | null;
  open: Record<"sourcing" | "booking" | "guests" | "day_of" | "closeout", boolean>;
  flagSource: string;
  taskOwners: { id: string; name: string }[];
  tasks: { id: string; title: string; kind: string; status: string; owner: string | null; due_date: string | null; canEdit: boolean; escalated: boolean; seeded: boolean; evidence: string | null; escalationPath: string; signedOffBy: string | null }[];
  vendors: { id: string; name: string; category: string; origin: string; functions: string[]; status: string; seeded: boolean; replacesVendorId: string | null; replacementContact: string | null; quote_inr: number | null; planned_inr: number | null; committed_inr: number | null; invoice_inr: number | null; paid_inr: number | null; authorizedBy: string | null; accepted_at: string | null; paid_at: string | null; viewUrl: string | null }[];
  spend: { planned: number; committed: number; actual: number; discrepancies: { vendorId: string; name: string; committed: number; invoice: number; diff: number; owner: string | null }[] } | null;
  openDeliverables: number;
  functions: { id: string; title: string; kind: string }[];
  guests: { id: string; name: string; party: number; rsvpUrl: string | null; canManageLink: boolean }[];
  rsvp: Record<string, { yes: number; no: number; people: number; veg: number; nonVeg: number }>;
  registry: { id: string; title: string; price_inr: number | null; reserved: boolean; reservedBy: string | null }[];
};

const STAGES = ["brief", "sourcing", "booking", "guests", "day_of", "closeout"];
const STAGE_LABEL: Record<string, string> = { brief: "Brief", sourcing: "Sourcing", booking: "Booking", guests: "Guests", day_of: "Day of", closeout: "Closeout" };
const CATS = ["venue", "caterer", "decor", "photo_video", "makeup", "dj_music", "mehendi", "pandit", "other"];
const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);
const input = "min-h-11 min-w-0 rounded-xl border border-line bg-card px-3 text-[15px] outline-none focus:border-marigold";
const btn = "pressable min-h-10 rounded-xl px-3 text-[14px] font-medium disabled:opacity-50";

/** Planner: stages unlocked by Flagsmith, owned tasks, vendors (authorize ≠ accept ≠ pay), spend, guests, registry. */
export function PlannerScreen({ view, onClose }: { view: View; onClose: () => void }) {
  const W = view.wedding.id;
  const [l, setL] = useState<L | null>(null);
  const [tab, setTab] = useState<"stage" | "vendors" | "guests">("stage");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useBackButton(onClose);

  const load = useCallback(() => api<{ lifecycle: L }>(`/api/lifecycle?wedding=${W}`).then((r) => setL(r.lifecycle)).catch((e) => setErr(e.message)), [W]);
  useWeddingLive(view.realtimeTopic, load);
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const initial = setTimeout(load, 0);
    const poll = setInterval(refreshVisible, 5000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      clearTimeout(initial);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [load]);

  async function act(action: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ lifecycle: L }>("/api/lifecycle", { body: { weddingId: W, action } });
      setL(r.lifecycle);
      haptic.success();
      return true;
    } catch (e) {
      haptic.error();
      const m = (e as Error).message;
      setErr(m.startsWith("stage_locked:") ? `Locked until the wedding reaches “${STAGE_LABEL[m.split(":")[1]]}” (Flagsmith stage gate).` : m);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Small local forms
  const [task, setTask] = useState("");
  const [taskOwner, setTaskOwner] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskEscalation, setTaskEscalation] = useState("");
  const [taskEvidence, setTaskEvidence] = useState("");
  const [deliverable, setDeliverable] = useState(false);
  const [vName, setVName] = useState("");
  const [vCat, setVCat] = useState("caterer");
  const [vOrigin, setVOrigin] = useState<"family" | "sourced">("sourced");
  const [vQuote, setVQuote] = useState("");
  const [vRunSheet, setVRunSheet] = useState("");
  const [vFns, setVFns] = useState<string[]>([]);
  const [gName, setGName] = useState("");
  const [gParty, setGParty] = useState("2");
  const [rTitle, setRTitle] = useState("");
  const [rPrice, setRPrice] = useState("");
  const copy = (path: string) => {
    const url = `${location.origin}${path}`;
    navigator.clipboard?.writeText(url).then(() => haptic.success()).catch(() => window.prompt("Copy this link", url));
  };

  if (!l) return <main className="mx-auto max-w-md p-6">{err ? <p className="text-sindoor">{err}</p> : <div className="h-40 animate-pulse rounded-3xl bg-card" />}</main>;
  const si = STAGES.indexOf(l.stage);

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div className="toran" />
      <main className="step-enter relative mx-auto w-full max-w-md px-5 pb-24 pt-6">
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-sindoor">Planner</p>
        <ol className="mt-3 flex gap-1" aria-label="Wedding stage">
          {STAGES.map((s, i) => (
            <li key={s} className={`flex-1 rounded-full py-1 text-center text-[11px] font-medium ${i < si ? "bg-mehendi/20" : i === si ? "bg-sindoor text-white" : "bg-card text-muted"}`}>{STAGE_LABEL[s]}</li>
          ))}
        </ol>
        <p className="mt-2 text-[12px] text-muted">Screens unlock with the wedding stage · {l.flagSource === "flagsmith" ? "Flagsmith" : "safe defaults"}</p>
        {l.me.isCouple && l.next ? (
          <button disabled={busy} onClick={() => act({ type: "advance_stage", expectedStage: l.stage })} className={`${btn} mt-2 w-full border border-marigold/60`}>Move to {STAGE_LABEL[l.next]} →</button>
        ) : null}

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-card p-1">
          {(["stage", "vendors", "guests"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`min-h-10 rounded-xl text-[14px] font-medium ${tab === t ? "bg-sindoor text-white" : ""}`}>{t === "stage" ? "Tasks" : t === "vendors" ? "Vendors & spend" : "Guests"}</button>
          ))}
        </div>
        {err ? <p className="mt-3 rounded-2xl border border-sindoor/40 bg-sindoor/10 px-4 py-3 text-[14px]">{err}</p> : null}

        {tab === "stage" ? (
          <section className="mt-4">
            {l.openDeliverables ? <p className="mb-3 rounded-2xl bg-marigold-soft px-4 py-3 text-[14px]">📦 {l.openDeliverables} deliverable{l.openDeliverables > 1 ? "s" : ""} still open (stays open after the wedding until delivered).</p> : null}
            <ul className="flex flex-col gap-2">
              {l.tasks.map((t) => (
                <li key={t.id} className={`rounded-2xl border px-4 py-3 ${t.escalated && t.status !== "done" ? "border-sindoor/50" : "border-line"} bg-card`}>
                  <div className="flex items-start gap-3">
                    <button aria-label="Toggle done" disabled={busy || !t.canEdit} onClick={() => act({ type: "task_status", taskId: t.id, status: t.status === "done" ? "open" : "done" })} className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border ${t.status === "done" ? "border-mehendi bg-mehendi text-white" : "border-line"}`}>{t.status === "done" ? "✓" : ""}</button>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[15px] ${t.status === "done" ? "text-muted line-through" : ""}`}>{t.kind === "incident" ? "⚠️ " : t.kind === "replacement" ? "🔁 " : t.kind === "deliverable" ? "📦 " : ""}{t.title}{t.seeded ? " (sample)" : ""}</p>
                      <p className="text-[12px] text-muted">{[t.owner && `Owner: ${t.owner}`, t.status, t.due_date && `due ${t.due_date}`, t.signedOffBy && `signed off by ${t.signedOffBy}`].filter(Boolean).join(" · ")}</p>
                    </div>
                    {l.me.isCouple && l.open.closeout && !t.signedOffBy && t.status !== "done" ? <button disabled={busy} onClick={() => act({ type: "sign_off", taskId: t.id })} className={`${btn} border border-line`}>Sign off</button> : null}
                  </div>
                  {t.evidence ? <p className="mt-2 break-words text-[13px]">Evidence · {t.evidence}</p> : null}
                  <p className="mt-1 text-[12px] text-muted">Escalation · {t.escalationPath}</p>
                  {t.canEdit ? <TaskUpdate key={`${t.id}:${t.status}:${t.evidence}`} task={t} busy={busy} save={act} /> : null}
                </li>
              ))}
              {!l.tasks.length ? <li className="text-[14px] text-muted">No tasks yet.</li> : null}
            </ul>
            <form className="mt-3 flex flex-col gap-2" onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ type: "add_task", title: task, kind: deliverable ? "deliverable" : "task",
                ownerMemberId: taskOwner || undefined, dueDate: taskDue || undefined,
                escalationPath: taskEscalation, evidence: taskEvidence })) {
                setTask("");
                setTaskOwner("");
                setTaskDue("");
                setTaskEscalation("");
                setTaskEvidence("");
              }
            }}>
              <div className="flex gap-2">
                <input className={`${input} flex-1`} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Add a task " maxLength={120} />
                <button className={`${btn} bg-sindoor text-white`} disabled={busy || !task.trim()}>Add</button>
              </div>
              {l.taskOwners.length > 1 ? <label className="grid gap-1 text-[13px]">Owner
                <select className={input} value={taskOwner} onChange={(e) => setTaskOwner(e.target.value)}>
                  <option value="">Me</option>
                  {l.taskOwners.filter((owner) => owner.id !== l.me.id).map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                </select>
              </label> : null}
              <label className="grid gap-1 text-[13px]">Due date <input className={input} type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} /></label>
              <label className="grid gap-1 text-[13px]">Escalation <input className={input} maxLength={120} placeholder="Ask the couple" value={taskEscalation} onChange={(e) => setTaskEscalation(e.target.value)} /></label>
              <label className="grid gap-1 text-[13px]">Evidence <textarea className={input} maxLength={300} value={taskEvidence} onChange={(e) => setTaskEvidence(e.target.value)} /></label>
              <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" checked={deliverable} onChange={(e) => setDeliverable(e.target.checked)} /> It’s a deliverable (album, film…)</label>
            </form>
          </section>
        ) : null}

        {tab === "vendors" ? (
          <section className="mt-4">
            {l.spend ? (
              <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                {(["planned", "committed", "actual"] as const).map((k) => (
                  <div key={k} className="rounded-2xl border border-line bg-card px-2 py-3"><p className="text-[11px] uppercase tracking-wider text-muted">{k}</p><p className="font-display text-[18px]">{inr(l.spend![k])}</p></div>
                ))}
              </div>
            ) : null}
            {l.spend?.discrepancies.map((d) => <p key={d.vendorId} className="mb-2 rounded-2xl border border-sindoor/40 bg-sindoor/10 px-4 py-2 text-[14px]">⚠️ {d.name}: invoice {inr(d.invoice)} vs approved {inr(d.committed)} ({d.diff > 0 ? "+" : ""}{inr(d.diff)}){d.owner ? ` · Owner: ${d.owner}` : ""}</p>)}
            {!l.open.sourcing ? <p className="rounded-2xl bg-card px-4 py-3 text-[14px] text-muted">🔒 Vendors open at the Sourcing stage.</p> : null}
            <ul className="flex flex-col gap-2">
              {l.vendors.map((v) => (
                <li key={v.id} className={`rounded-2xl border border-line bg-card px-4 py-3 ${v.status === "cancelled" ? "opacity-60" : ""}`}>
                  <p className="font-medium">{v.name} <span className="text-[12px] font-normal text-muted">· {v.category.replace("_", " ")} · {v.origin === "family" ? "family’s own" : "sourced"}{v.seeded ? " · sample" : ""}</span></p>
                  <p className="text-[12px] text-muted">{v.functions.join(", ") || "No functions assigned"}{l.me.isCouple ? ` · quote ${inr(v.quote_inr)} · paid ${inr(v.paid_inr)}` : ""}</p>
                  <p className="mt-1 text-[12px]">
                    {v.status === "cancelled" ? "❌ cancelled" : [v.authorizedBy ? `✓ authorized by ${v.authorizedBy}` : "○ not authorized", v.accepted_at ? "✓ vendor accepted" : "○ vendor hasn’t accepted", v.paid_at ? "✓ paid" : "○ unpaid"].join(" · ")}
                  </p>
                  {v.replacementContact ? <p className="mt-1 break-words text-[12px]">Replacement contact · {v.replacementContact}</p> : null}
                  {v.status === "cancelled" && l.open.day_of && l.me.decider
                    && !l.vendors.some((candidate) => candidate.replacesVendorId === v.id && candidate.status !== "cancelled") ? (
                    <ReplacementForm vendorId={v.id} canQuote={l.me.isCouple} busy={busy} save={act} />
                  ) : null}
                  {v.status !== "cancelled" ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {l.me.decider && l.open.booking && v.status === "shortlisted" && !v.replacesVendorId ? <button disabled={busy} onClick={() => act({ type: "authorize_vendor", vendorId: v.id })} className={`${btn} bg-mehendi text-white`}>Authorize booking</button> : null}
                      {l.me.decider && l.open.booking && v.status === "authorized" ? <button disabled={busy} onClick={() => act({ type: "vendor_accepted", vendorId: v.id })} className={`${btn} border border-line`}>Vendor accepted</button> : null}
                      {l.me.isCouple && v.status !== "shortlisted" ? <button disabled={busy} onClick={() => { const inv = window.prompt("Invoice amount (₹)", String(v.invoice_inr ?? v.committed_inr ?? "")); const paid = window.prompt("Paid so far (₹)", String(v.paid_inr ?? 0)); if (inv !== null || paid !== null) act({ type: "vendor_money", vendorId: v.id, invoiceInr: inv || undefined, paidInr: paid || undefined }); }} className={`${btn} border border-line`}>Invoice / payment</button> : null}
                      {v.viewUrl ? <button onClick={() => copy(v.viewUrl!)} className={`${btn} border border-line`}>Copy run-sheet link</button> : null}
                      {l.me.decider && l.open.day_of && v.status !== "shortlisted" ? <button disabled={busy} onClick={() => {
                        if (!v.viewUrl || window.confirm("Replace the run-sheet link? The current link will stop working.")) void act({ type: "rotate_vendor_link", vendorId: v.id });
                      }} className={`${btn} border border-line`}>{v.viewUrl ? "Replace link" : "Renew link"}</button> : null}
                      {l.me.decider && l.open.day_of ? <details>
                        <summary className={`${btn} flex cursor-pointer items-center border border-sindoor/50 text-sindoor`}>Record cancellation</summary>
                        <form className="mt-2 grid gap-2" onSubmit={(event) => {
                          event.preventDefault();
                          const fields = new FormData(event.currentTarget);
                          void act({ type: "cancel_vendor", vendorId: v.id, reason: fields.get("reason"), simulated: fields.has("simulated") });
                        }}>
                          <label className="grid gap-1 text-[13px]">Reason <input name="reason" maxLength={120} className={input} /></label>
                          <label className="flex items-center gap-2 text-[13px]"><input name="simulated" type="checkbox" /> Label as simulated</label>
                          <button className={`${btn} border border-line`} disabled={busy}>Record</button>
                        </form>
                      </details> : null}
                      {v.status === "shortlisted" && v.replacesVendorId ? <p className="text-[13px] text-muted">Awaiting couple approval in the shared plan</p> : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {l.me.decider && l.open.sourcing ? (
              <form className="mt-3 flex flex-col gap-2 rounded-2xl border border-dashed border-marigold/60 p-3" onSubmit={(e) => { e.preventDefault(); act({ type: "add_vendor", name: vName, category: vCat, origin: vOrigin, quoteInr: vQuote || undefined, functions: vFns, runSheet: vRunSheet }).then((saved) => { if (saved) { setVName(""); setVQuote(""); setVFns([]); setVRunSheet(""); } }); }}>
                <input className={input} value={vName} onChange={(e) => setVName(e.target.value)} placeholder="Vendor name (e.g. our family caterer)" maxLength={80} />
                <div className="flex gap-2">
                  <select className={`${input} flex-1`} value={vCat} onChange={(e) => setVCat(e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}</select>
                  <select className={`${input} flex-1`} value={vOrigin} onChange={(e) => setVOrigin(e.target.value as "family" | "sourced")}><option value="sourced">Sourced</option><option value="family">Family’s own</option></select>
                </div>
                <label className="grid gap-1 text-[13px]">Vendor run sheet · brief, arrival and contact <textarea className={input} maxLength={2000} value={vRunSheet} onChange={(e) => setVRunSheet(e.target.value)} /></label>
                <input className={input} inputMode="numeric" value={vQuote} onChange={(e) => setVQuote(e.target.value.replace(/\D/g, ""))} placeholder="Quote ₹ (optional)" />
                <div className="flex flex-wrap gap-1.5">
                  {l.functions.map((f) => <button type="button" key={f.id} onClick={() => setVFns((x) => (x.includes(f.kind === "other" ? f.title : f.kind) ? x.filter((y) => y !== (f.kind === "other" ? f.title : f.kind)) : [...x, f.kind === "other" ? f.title : f.kind]))} className={`rounded-full border px-3 py-1 text-[13px] ${vFns.includes(f.kind === "other" ? f.title : f.kind) ? "border-sindoor bg-sindoor text-white" : "border-line"}`}>{f.title}</button>)}
                </div>
                <button className={`${btn} bg-sindoor text-white`} disabled={busy || !vName.trim()}>Add vendor</button>
              </form>
            ) : null}
          </section>
        ) : null}

        {tab === "guests" ? (
          <section className="mt-4">
            {!l.open.guests ? <p className="mb-3 rounded-2xl bg-card px-4 py-3 text-[14px] text-muted">🔒 Guest list opens at the Guests stage.</p> : null}
            <ul className="grid grid-cols-2 gap-2">
              {l.functions.map((f) => {
                const c = l.rsvp[f.id];
                return <li key={f.id} className="rounded-2xl border border-line bg-card px-3 py-2"><p className="font-medium">{f.title}</p><p className="text-[12px] text-muted">{c ? `${c.people} coming · ${c.veg} veg / ${c.nonVeg} non-veg · ${c.no} declined` : "No RSVPs yet"}</p></li>;
              })}
            </ul>
            <h3 className="mt-5 font-medium">Guests ({l.guests.length})</h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {l.guests.map((g) => (
                <li key={g.id} className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-[15px]"><span className="flex-1">{g.name} <span className="text-muted">×{g.party}</span></span>{g.rsvpUrl ? <button onClick={() => copy(g.rsvpUrl!)} className={`${btn} border border-line`}>Copy RSVP link</button> : null}
                {g.canManageLink ? <button disabled={busy} onClick={() => {
                  if (!g.rsvpUrl || window.confirm("Replace the RSVP link? The current link will stop working.")) void act({ type: "rotate_guest_link", guestId: g.id });
                }} className={`${btn} border border-line`}>{g.rsvpUrl ? "Replace link" : "Renew link"}</button> : null}</li>
              ))}
            </ul>
            {l.open.guests ? (
              <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); act({ type: "add_guest", name: gName, party: Number(gParty) }).then(() => setGName("")); }}>
                <input className={`${input} flex-1`} value={gName} onChange={(e) => setGName(e.target.value)} placeholder="Guest or family name" maxLength={80} />
                <input className={`${input} w-16`} inputMode="numeric" value={gParty} onChange={(e) => setGParty(e.target.value.replace(/\D/g, ""))} aria-label="Party size" />
                <button className={`${btn} bg-sindoor text-white`} disabled={busy || !gName.trim()}>Add</button>
              </form>
            ) : null}
            <h3 className="mt-5 font-medium">Gift registry</h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {l.registry.map((i) => <li key={i.id} className="flex justify-between rounded-xl border border-line bg-card px-3 py-2 text-[15px]"><span>{i.title} <span className="text-muted">{i.price_inr ? inr(i.price_inr) : ""}</span></span><span className="text-[13px] text-muted">{i.reserved ? `Reserved${i.reservedBy ? ` by ${i.reservedBy}` : ""}` : "Free"}</span></li>)}
            </ul>
            {l.me.isCouple ? (
              <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); act({ type: "add_registry", title: rTitle, priceInr: rPrice || undefined }).then(() => { setRTitle(""); setRPrice(""); }); }}>
                <input className={`${input} flex-1`} value={rTitle} onChange={(e) => setRTitle(e.target.value)} placeholder="Gift (e.g. pressure cooker)" maxLength={80} />
                <input className={`${input} w-24`} inputMode="numeric" value={rPrice} onChange={(e) => setRPrice(e.target.value.replace(/\D/g, ""))} placeholder="₹" />
                <button className={`${btn} bg-sindoor text-white`} disabled={busy || !rTitle.trim()}>Add</button>
              </form>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}


function TaskUpdate({ task, busy, save }: {
  task: L["tasks"][number];
  busy: boolean;
  save: (action: Record<string, unknown>) => Promise<boolean>;
}) {
  const [status, setStatus] = useState(task.status);
  const [evidence, setEvidence] = useState(task.evidence ?? "");

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[13px] font-medium">Update task</summary>
      <form className="mt-2 grid gap-2" onSubmit={(e) => {
        e.preventDefault();
        void save({ type: "task_status", taskId: task.id, status, evidence });
      }}>
        <label className="grid gap-1 text-[13px]">Status <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select></label>
        <label className="grid gap-1 text-[13px]">Evidence <textarea className={input} maxLength={300} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
        <button className={`${btn} border border-line`} disabled={busy}>Save task</button>
      </form>
    </details>
  );
}

function ReplacementForm({ vendorId, canQuote, busy, save }: {
  vendorId: string;
  canQuote: boolean;
  busy: boolean;
  save: (action: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[13px] font-medium">Record replacement contact</summary>
      <form className="mt-2 grid gap-2" onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        void save({ type: "propose_replacement", vendorId, name: fields.get("name"),
          contact: fields.get("contact"), runSheet: fields.get("runSheet"), quoteInr: fields.get("quote") || undefined });
      }}>
        <label className="grid gap-1 text-[13px]">Vendor name <input name="name" required maxLength={80} className={input} /></label>
        <label className="grid gap-1 text-[13px]">Contact and confirmation details <textarea name="contact" required maxLength={300} className={input} /></label>
        <label className="grid gap-1 text-[13px]">Vendor run sheet · brief, arrival and contact <textarea name="runSheet" maxLength={2000} className={input} /></label>
        {canQuote ? <label className="grid gap-1 text-[13px]">Quote (₹) <input name="quote" type="number" min={0} className={input} /></label> : null}
        <button className={`${btn} border border-line`} disabled={busy}>Send to shared plan</button>
      </form>
    </details>
  );
}
