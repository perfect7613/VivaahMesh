// End-to-end live check against a deployment, with signed Telegram initData.
//   node scripts/e2e-live.mjs https://vivaahmesh.vercel.app
// Creates a throwaway wedding (Telegram ids 9100000xx) and prints its ID for cleanup.
import { createHmac } from "node:crypto";

import { rehearsalOrigin } from "./rehearsal-origin.mjs";

const BASE = rehearsalOrigin(process.argv[2] ?? "http://localhost:3000");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const sign = (user) => {
  const p = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) };
  const dcs = Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join("\n");
  p.hash = createHmac("sha256", createHmac("sha256", "WebAppData").update(TOKEN).digest()).update(dcs).digest("hex");
  return new URLSearchParams(p).toString();
};
const call = async (user, path, body, method) => {
  const r = await fetch(BASE + path, {
    redirect: "error",
    method: method ?? (body ? "POST" : "GET"),
    headers: { authorization: `tma ${sign(user)}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const meera = { id: 910000001, first_name: "Meera", language_code: "mr" };
const aai = { id: 910000002, first_name: "Aai", language_code: "mr" };
const riya = { id: 910000003, first_name: "Riya", language_code: "ta" };

let r = await call(meera, "/api/weddings", {
  partnerA: "Meera", partnerB: "Aarav", weddingDate: "2027-02-14", city: "Pune",
  functions: ["sangeet", "ceremony", "Tilak", "Jaggo"], guestCount: 350, budgetInr: 1500000,
  myFamily: "Patil family", otherFamily: "Deshmukh family", displayName: "Meera", language: "mr",
});
ok(r.status === 200, "couple creates the wedding");
const v = r.json.view;
const W = v.wedding.id;
ok(v.functions.some((f) => f.title === "Tilak") && v.functions.some((f) => f.title === "Jaggo"), "family-named functions (Tilak, Jaggo) created");

const sangeet = v.functions.find((f) => f.kind === "sangeet");
r = await call(meera, "/api/functions", { functionId: sangeet.id, onDate: "2027-02-13", startsAt: "18:00", venue: "Shubh Mangal Lawns", details: "Cousins' dance after dinner" }, "PATCH");
ok(r.status === 200 && r.json.view.functions.find((f) => f.id === sangeet.id).venue === "Shubh Mangal Lawns", "couple fills in Sangeet date, time and venue");

const hA = v.households.find((h) => h.side === "A"), hB = v.households.find((h) => h.side === "B");
r = await call(aai, "/api/join", { code: hA.inviteCode, displayName: "Aai", role: "parent", language: "mr", priorities: ["elders_dinner"], note: "", visibility: "shared" });
ok(r.status === 200, "Aai joins (Marathi)");
const parentId = r.json.view.me.id;
ok(r.json.view.me.role === "parent" && !r.json.view.me.canManage, "Aai has a parent label before the couple grants access");
r = await call(meera, "/api/weddings/parent-access", { weddingId: W, memberId: parentId, granted: true }, "PATCH");
ok(r.status === 200, "couple grants parent access");
r = await call(riya, "/api/join", { code: hB.inviteCode, displayName: "Riya", role: "cousin", language: "ta", priorities: ["dance"], note: "", visibility: "shared" });
ok(r.status === 200 && r.json.view.me.language === "ta", "Riya joins in Tamil");

r = await call(riya, "/api/functions", { functionId: sangeet.id, venue: "x" }, "PATCH");
ok(r.status === 403, "a cousin cannot edit function details");

const t0 = Date.now();
r = await call(riya, "/api/i18n?lang=ta");
const ta = r.json;
ok(r.status === 200 && typeof ta.data?.continue === "string" && ta.data.continue !== "Continue", `Tamil UI strings by GLM (${Math.round((Date.now() - t0) / 1000)}s): continue = ${ta.data?.continue}`);

r = await call(meera, "/api/plan", { weddingId: W });
ok(r.status === 200 && r.json.plan.result.blocking.some((b) => b.code === "cutoff_unconfirmed"), "sample Sangeet: blocked on the venue's music cutoff");
ok(r.json.plan.policy?.source === "flagsmith", `plan ranked with Flagsmith policy ${r.json.plan.policy?.version} (${r.json.plan.policy?.strategy})`);

r = await call(riya, "/api/calls", { weddingId: W });
ok(r.status === 403, "a cousin cannot authorize a call");
r = await call(aai, `/api/calls?wedding=${W}`);
ok(r.status === 200 && r.json.configured, `call preview: ${r.json.recipient?.name}, dialing ${r.json.dialingEnabled ? "on" : "off"}, rehearsal ${!!r.json.rehearsal}`);
const dialing = r.json.dialingEnabled && r.json.rehearsal;
if (r.json.dialingEnabled && !r.json.rehearsal) throw new Error("This rehearsal requires the simulated dialing channel");
r = await call(aai, "/api/calls", { weddingId: W, rehearsalOnly: true });
ok(r.status === 200 && r.json.call.status === (dialing ? "dialing" : "blocked"), `Aai authorizes → ${r.json.call?.status}`);

if (dialing) {
  let applied = false;
  for (let i = 0; i < 12 && !applied; i++) {
    await sleep(2500);
    const p = await call(aai, `/api/calls?wedding=${W}`);
    applied = !!p.json.lastCall?.processed_at;
  }
  ok(applied, "rehearsal venue answer stored and applied");
  r = await call(meera, `/api/plan?wedding=${W}`);
  const plan = r.json.plan;
  const cutoff = plan.facts.filter((f) => f.kind === "music_cutoff" && f.status === "confirmed").at(-1); // the correction wins
  ok(cutoff?.value === 1350 && cutoff.channel === "seed" && cutoff.wording.startsWith("[Rehearsal]"), "cutoff 10:30 pm, labelled as rehearsal");
  ok(plan.result.proposals.length > 0, `options appear: ${plan.result.proposals.length}`);

  const stale = await call(meera, "/api/approvals", { weddingId: W, proposalId: plan.result.proposals[0].id, revision: plan.revision - 1 });
  ok(stale.status === 409 && String(stale.json.error).startsWith("stale"), "approval from an outdated screen is rejected");
  const notCouple = await call(aai, "/api/approvals", { weddingId: W, proposalId: plan.result.proposals[0].id, revision: plan.revision });
  ok(notCouple.status === 403, "only the couple approves");
  const yes = await call(meera, "/api/approvals", { weddingId: W, proposalId: plan.result.proposals[0].id, revision: plan.revision });
  ok(yes.status === 200 && yes.json.plan.committed?.proposalId === plan.result.proposals[0].id, "couple approves option 1");
  const again = await call(meera, "/api/approvals", { weddingId: W, proposalId: plan.result.proposals[1]?.id ?? plan.result.proposals[0].id, revision: plan.revision });
  ok(again.status === 409, `a second approval on the old revision is refused (${again.json.error})`);
}

r = await call(aai, "/api/agent", { weddingId: W });
ok(r.status === 200, "Check now wakes the agent");
let feed = [];
for (let i = 0; i < 20 && !feed.some((x) => x.status === "done" && x.trigger === "manual"); i++) {
  await sleep(3000);
  feed = (await call(riya, `/api/agent?wedding=${W}`)).json.runs ?? [];
}
const done = feed.find((x) => x.status === "done");
ok(!!done, `agent ran (${feed.map((x) => x.trigger).join(", ")}): ${done?.text ?? "-"}`);

await sleep(2000);
r = await call(aai, "/api/agent/ask", { weddingId: W, question: "/search Sangeet DJ prices in Pune" });
ok(r.status === 200 && !!r.json.answer, `ask anything (web: ${(r.json.searched ?? []).join(" | ") || "none"}): ${(r.json.answer ?? r.json.reason ?? "").slice(0, 300)}`);

console.log(JSON.stringify({ weddingId: W }));
process.exit(fails ? 1 : 0);
