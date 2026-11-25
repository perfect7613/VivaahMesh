// End-to-end check of the onboarding API against a deployment, using properly signed initData.
// Usage (from web/): set -a; . ./.env.local; set +a; node scripts/e2e-onboarding.mjs https://vivaahmesh.vercel.app
// Creates a test wedding with fake Telegram users; delete it afterwards (the script prints its id).
import crypto from "node:crypto";

const BASE = process.argv[2];
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();

function initData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "e2e" + user.id, user: JSON.stringify(user) });
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  p.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex"));
  return p.toString();
}
async function call(user, path, body) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", authorization: `tma ${initData(user)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };

const couple = { id: 900000001, first_name: "Meera", language_code: "mr" };
const aai = { id: 900000002, first_name: "Aai", language_code: "mr" };
const riya = { id: 900000003, first_name: "Riya", language_code: "hi" };
const stranger = { id: 900000004, first_name: "Stranger" };

// Unauthenticated and forged requests are refused
ok((await fetch(BASE + "/api/me")).status === 401, "no initData → 401");
ok((await fetch(BASE + "/api/me", { headers: { authorization: "tma " + initData(couple).replace(/hash=\w+/, "hash=" + "0".repeat(64)) } })).status === 401, "bad hash → 401");
ok((await fetch(BASE + "/api/me", { headers: { "x-dev-user": "1:Dev" } })).status === 401, "dev bypass disabled in production");

// Couple creates the wedding
let r = await call(couple, "/api/me");
ok(r.status === 200 && r.json.view === null, "new user has no wedding");
r = await call(couple, "/api/weddings", {
  partnerA: "Meera", partnerB: "Aarav", weddingDate: "2027-02-14", city: "Pune",
  functions: ["sangeet", "ceremony", "reception"], guestCount: 350, budgetInr: 1500000,
  myFamily: "Patil family", otherFamily: "Deshmukh family", language: "mr",
});
ok(r.status === 200 && r.json.view?.wedding?.partnerA === "Meera", "couple creates wedding");
const v = r.json.view;
const patil = v.households.find((h) => h.side === "A");
const deshmukh = v.households.find((h) => h.side === "B");
ok(v.wedding.budgetInr === 1500000, "couple sees budget");
ok(v.functions.length === 3, "three functions created");
ok(!!patil.inviteCode && !!deshmukh.inviteCode && !!v.wedding.coupleCode, "couple sees both invite codes + partner code");

// Invite preview + joins
r = await call(aai, `/api/invites/${patil.inviteCode}`);
ok(r.status === 200 && r.json.family === "Patil family" && r.json.couple === "Meera & Aarav", "invite preview for Patil family");
r = await call(aai, "/api/join", { code: patil.inviteCode, displayName: "Aai", role: "parent", language: "mr", priorities: ["elders_dinner"], note: "आजीसाठी जेवण ८:३० ला", visibility: "household" });
ok(r.status === 200 && r.json.view.me.role === "parent", "Aai joins Patil family");
ok(r.json.view.wedding.budgetInr === null, "Aai (not couple) does NOT see budget");
ok(r.json.view.households.find((h) => h.side === "B").inviteCode === null, "Aai cannot see Deshmukh invite code");

r = await call(riya, "/api/join", { code: deshmukh.inviteCode, displayName: "Riya", role: "cousin", language: "hi", priorities: ["dance", "pure_veg"], visibility: "shared" });
ok(r.status === 200, "Riya joins Deshmukh family");
const riyaView = r.json.view;
ok(!riyaView.priorities.some((p) => p.note === "आजीसाठी जेवण ८:३० ला"), "Patil-private note hidden from Deshmukh family");
ok(riyaView.priorities.some((p) => p.kind === "dance" && p.author === "Riya" && p.family === "Deshmukh family"), "shared priority attributed to Riya · Deshmukh family");

r = await call(aai, "/api/me");
ok(r.json.view.priorities.some((p) => p.note === "आजीसाठी जेवण ८:३० ला" && p.visibility === "household"), "Aai still sees her private note");
ok(r.json.view.priorities.some((p) => p.kind === "dance"), "Aai sees Riya's shared priority");

r = await call(stranger, "/api/invites/doesnotexist");
ok(r.status === 404, "unknown invite → 404");
r = await call(stranger, "/api/priorities", { priorities: ["dance"] });
ok(r.status === 403, "non-member cannot add priorities");

console.log(JSON.stringify({ weddingId: v.wedding.id }));
