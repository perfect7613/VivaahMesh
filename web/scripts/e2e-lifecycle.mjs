// Live check of the lifecycle (#11–#14) against a deployment. Throwaway wedding, deleted at the end.
//   set -a; . ./.env.local; set +a; node scripts/e2e-lifecycle.mjs https://vivaahmesh.vercel.app
import { rehearsalOrigin } from "./rehearsal-origin.mjs";
import { createHmac, randomUUID } from "node:crypto";

const BASE = rehearsalOrigin(process.argv[2] ?? "http://localhost:3000");
const marker = `QA ${randomUUID()}`;
const sign = (user) => {
  const p = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) };
  const dcs = Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join("\n");
  p.hash = createHmac("sha256", createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN).digest()).update(dcs).digest("hex");
  return new URLSearchParams(p).toString();
};
const call = async (user, path, body, method) => {
  const r = await fetch(BASE + path, { redirect: "error", method: method ?? (body ? "POST" : "GET"), headers: { ...(user ? { authorization: `tma ${sign(user)}` } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) fails++; };
const meera = { id: 920000001, first_name: "Meera" }, aai = { id: 920000002, first_name: "Aai" }, riya = { id: 920000003, first_name: "Riya" };

let r = await call(meera, "/api/weddings", { partnerA: "Meera", partnerB: marker, weddingDate: "2027-02-14", city: "Pune", functions: ["haldi", "sangeet", "ceremony"], guestCount: 200, budgetInr: 1500000, myFamily: "Patil family", otherFamily: "Deshmukh family", displayName: "Meera", language: "en" });
const W = r.json.view.wedding.id;
const hA = r.json.view.households.find((h) => h.side === "A"), hB = r.json.view.households.find((h) => h.side === "B");
const joined = await call(aai, "/api/join", { code: hA.inviteCode, displayName: "Aai", role: "parent", language: "mr", priorities: ["elders_dinner"], note: "Private: elders must eat by 8", visibility: "household" });
await call(meera, "/api/weddings/parent-access", { weddingId: W, memberId: joined.json.view.me.id, granted: true }, "PATCH");
await call(riya, "/api/join", { code: hB.inviteCode, displayName: "Riya", role: "cousin", language: "en", priorities: [], note: "", visibility: "shared" });
const act = (u, action) => call(u, "/api/lifecycle", { weddingId: W, action });

try {
  r = await call(meera, `/api/lifecycle?wedding=${W}`);
  ok(r.status === 200 && r.json.lifecycle.stage === "brief", `planner loads at stage brief (flags: ${r.json.lifecycle?.flagSource})`);
  r = await act(meera, { type: "add_vendor", name: "Kaka's Caterers", category: "caterer", origin: "family", functions: ["haldi", "sangeet", "ceremony"], quoteInr: 380000 });
  ok(r.status === 409 && r.json.error === "stage_locked:sourcing", `vendors locked at brief (${r.json.error})`);
  r = await act(aai, { type: "advance_stage", expectedStage: "brief" });
  ok(r.status === 403, "only the couple moves the stage");
  r = await act(meera, { type: "advance_stage", expectedStage: "brief" });
  ok(r.json.lifecycle?.stage === "sourcing", "couple → sourcing");
  r = await act(meera, { type: "add_vendor", name: "Kaka's Caterers", category: "caterer", origin: "family", functions: ["haldi", "sangeet", "ceremony"], quoteInr: 380000 });
  const v = r.json.lifecycle?.vendors?.[0];
  ok(r.status === 200 && v?.origin === "family", "family's own caterer added (3-function package)");
  r = await act(aai, { type: "authorize_vendor", vendorId: v.id });
  ok(r.status === 409 && r.json.error === "stage_locked:booking", `sourcing wedding cannot book (${r.json.error})`);
  r = await act(meera, { type: "advance_stage", expectedStage: "sourcing" });
  ok(r.json.lifecycle?.stage === "booking" && r.json.lifecycle.open.booking, `couple → booking (open: ${JSON.stringify(r.json.lifecycle?.open)})`);
  ok(r.json.lifecycle && !r.json.lifecycle.open.closeout, "closeout still locked at booking");
  r = await act(riya, { type: "authorize_vendor", vendorId: v.id });
  ok(r.status === 403, "a cousin cannot authorize a booking");
  r = await act(aai, { type: "authorize_vendor", vendorId: v.id, committedInr: 360000 });
  const va = r.json.lifecycle?.vendors?.[0];
  ok(va?.status === "authorized" && va.authorizedBy === "Aai" && !va.accepted_at && !va.paid_at, "Aai authorizes; vendor acceptance and payment still separate");
  r = await act(aai, { type: "vendor_accepted", vendorId: v.id });
  ok(r.json.lifecycle?.vendors?.[0]?.status === "accepted", "vendor accepted");
  r = await act(meera, { type: "vendor_money", vendorId: v.id, invoiceInr: 395000, paidInr: 100000 });
  const sp = r.json.lifecycle?.spend;
  ok(sp && sp.planned === 380000 && sp.committed === 360000 && sp.actual === 100000, `spend planned/committed/actual = ${sp?.planned}/${sp?.committed}/${sp?.actual} (package counted once)`);
  ok(sp?.discrepancies?.[0]?.diff === 35000, "invoice ₹35k above approved is flagged");
  const inc = r.json.lifecycle?.tasks?.find((t) => t.title.startsWith("Invoice from"));
  ok(inc?.owner === "Aai", `discrepancy has an owner (${inc?.owner}: ${inc?.title})`);
  r = await call(riya, `/api/lifecycle?wedding=${W}`);
  ok(r.json.lifecycle?.spend === null && r.json.lifecycle?.vendors?.[0]?.quote_inr === null, "cousin sees no money");

  const token = (await call(meera, `/api/lifecycle?wedding=${W}`)).json.lifecycle.vendors[0].viewUrl.split("/").pop();
  r = await call(null, `/api/vendor/${token}`);
  const txt = JSON.stringify(r.json);
  ok(r.status === 200 && r.json.functions.length === 3 && !/inr|budget|quote|Patil|priorit/i.test(txt), "vendor run sheet: its 3 functions, no money, no family notes");

  r = await act(meera, { type: "add_task", title: "Wedding album delivered", kind: "deliverable" });
  ok(r.json.lifecycle?.openDeliverables === 1, "deliverable task created");
  r = await act(meera, { type: "advance_stage", expectedStage: "booking" });
  ok(r.json.lifecycle?.stage === "guests", "couple → guests");
  r = await act(aai, { type: "add_guest", name: "Joshi kaka & family", party: 4 });
  r = await act(aai, { type: "add_guest", name: "Kulkarni aaji", party: 1 });
  r = await act(meera, { type: "add_registry", title: "Silver puja thali", priceInr: 12000 });
  const L = r.json.lifecycle;
  const [g1, g2] = L.guests.map((g) => g.rsvpUrl.split("/").pop());
  const fSangeet = L.functions.find((f) => f.kind === "sangeet").id, fCer = L.functions.find((f) => f.kind === "ceremony").id;
  r = await call(null, `/api/rsvp/${g1}`, { functionId: fSangeet, attending: true, people: 4, veg: 3 });
  ok(r.status === 200 && r.json.rsvps.length === 1, "guest RSVPs for Sangeet (no Telegram)");
  ok(!/elders|private|priorit|note|budget|Patil|Deshmukh/i.test(JSON.stringify(r.json)), "guest page carries no family notes, budgets or family names");
  await call(null, `/api/rsvp/${g1}`, { functionId: fCer, attending: false });
  r = await call(meera, `/api/lifecycle?wedding=${W}`);
  const c = r.json.lifecycle.rsvp;
  ok(c[fSangeet]?.people === 4 && c[fSangeet]?.veg === 3 && c[fCer]?.people === 0 && c[fCer]?.no === 1, "counts per function: Sangeet 4 (3 veg), ceremony declined");
  const item = r.json.lifecycle.registry[0].id;
  const race = await Promise.all([call(null, `/api/rsvp/${g1}`, { reserve: item }), call(null, `/api/rsvp/${g2}`, { reserve: item })]);
  ok(race.filter((x) => x.status === 200).length === 1 && race.filter((x) => x.status === 409).length === 1, `two guests, one gift: ${race.map((x) => x.status).join(" / ")}`);
  const winner = race.findIndex((x) => x.status === 200);
  r = await call(null, `/api/rsvp/${winner === 0 ? g2 : g1}`);
  const winnerName = winner === 0 ? "Joshi" : "Kulkarni";
  ok(r.json.registry[0].state === "taken" && !JSON.stringify(r.json).includes(winnerName), "the other guest sees 'taken', never who");

  r = await act(aai, { type: "cancel_vendor", vendorId: v.id, reason: "double-booked" });
  const kinds = r.json.lifecycle?.tasks?.map((t) => t.kind) ?? [];
  if (r.status !== 200) console.log("cancel:", r.status, r.json.error);
  ok(kinds.includes("incident") && kinds.includes("replacement"), "cancellation → owned incident + replacement task");
  ok((await call(meera, `/api/lifecycle?wedding=${W}`)).json.lifecycle?.spend?.planned === 0, "cancelled vendor leaves the spend (couple's view)");

  r = await act(meera, { type: "advance_stage", expectedStage: "guests" });
  r = await act(meera, { type: "advance_stage", expectedStage: "day_of" });
  ok(r.json.lifecycle?.stage === "closeout", "couple → closeout");
  const del = r.json.lifecycle.tasks.find((t) => t.kind === "deliverable");
  r = await act(meera, { type: "sign_off", taskId: del.id });
  ok(r.json.lifecycle?.tasks?.find((t) => t.id === del.id)?.signedOffBy === "Meera" && r.json.lifecycle.openDeliverables === 1, "couple signs off; the album task stays open until delivered");
} finally {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (u && k && /^[0-9a-f-]{36}$/i.test(W)) {
    const url = new URL("/rest/v1/weddings", rehearsalOrigin(u));
    url.search = new URLSearchParams({ id: `eq.${W}`, created_by_tg: `eq.${meera.id}`, partner_b: `eq.${marker}` });
    const cleanup = await fetch(url, { method: "DELETE", redirect: "error", headers: { apikey: k, authorization: `Bearer ${k}` } });
    if (!cleanup.ok) throw new Error(`Rehearsal cleanup returned HTTP ${cleanup.status}`);
  } else {
    console.log("Rehearsal wedding retained", W);
  }
}
process.exit(fails ? 1 : 0);
