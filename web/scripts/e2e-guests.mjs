// End-to-end check of guest RSVPs and the gift registry (issue #12) against a deployment.
// Needs the 20261125160000_guests_registry.sql migration applied, and the Flagsmith flag
// `stage_guests` enabled for the test wedding (e.g. via the wedding_stage segment).
// Usage (from web/): set -a; . ./.env.local; set +a; node scripts/e2e-guests.mjs https://<deployment>
// Creates a test wedding with fake Telegram users. Midway it asks an admin to move the wedding to the
// `guests` stage (the stage is not changeable through the API yet; that is issue #11).
import crypto from "node:crypto";
import readline from "node:readline/promises";

const BASE = process.argv[2];
if (!BASE) throw new Error("usage: node scripts/e2e-guests.mjs <base-url>");
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();

function initData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "e2e" + user.id, user: JSON.stringify(user) });
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  p.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex"));
  return p.toString();
}
// Family calls use signed Telegram initData; guest calls use only their access link.
async function call(user, path, body) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(user ? { authorization: `tma ${initData(user)}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };

const base = 920000000 + Math.floor(Math.random() * 1_000_000) * 10;
const couple = { id: base + 1, first_name: "Meera", language_code: "mr" };
const aai = { id: base + 2, first_name: "Aai", language_code: "mr" };

// Setup: wedding (three functions), Aai joins the Patil family.
let r = await call(couple, "/api/weddings", {
  partnerA: "Meera", partnerB: "Aarav", functions: ["sangeet", "ceremony", "reception"], myFamily: "Patil family", otherFamily: "Deshmukh family", language: "mr",
  budgetInr: 1500000,
});
ok(r.status === 200, "couple creates wedding");
const v = r.json.view;
const wid = v.wedding.id;
const [sangeet, ceremony] = [v.functions.find((f) => f.kind === "sangeet"), v.functions.find((f) => f.kind === "ceremony")];
await call(aai, "/api/join", { code: v.households.find((h) => h.side === "A").inviteCode, displayName: "Aai", role: "parent", language: "mr", priorities: [], note: "PRIVATE: budget under 12 lakh", visibility: "household" });
console.log(`      test wedding id: ${wid}`);

// While the wedding is still in the brief stage, the guest area is locked, for families and guests.
r = await call(couple, `/api/guests?wedding=${wid}`);
ok(r.status === 403 && r.json.error === "stage_locked", "family guest area locked before the guests stage");
r = await call(null, "/api/guest?code=doesnotexist");
ok(r.status === 404, "unknown guest code → 404");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(`\n      Admin step: move this wedding to the guests stage, and make sure stage_guests is on:\n        update weddings set stage = 'guests' where id = '${wid}';\n`);
await rl.question("      Press Enter once done… ");
rl.close();

// Family adds guests and a one-of-a-kind registry item.
r = await call(couple, "/api/guests", { weddingId: wid, name: "Priya Patil", side: "A" });
ok(r.status === 200 && !!r.json.guest.accessCode, "couple adds a guest and gets an access link");
const priya = r.json.guest.accessCode;
r = await call(aai, "/api/guests", { weddingId: wid, name: "Rohan Patil" });
ok(r.status === 200, "a parent adds a guest to their own family");
const rohan = r.json.guest.accessCode;
r = await call(couple, "/api/guests", { weddingId: wid, name: "Zoya Khan", side: "B" });
const zoya = r.json.guest.accessCode;
r = await call(aai, "/api/guests/registry", { weddingId: wid, title: "Brass lamp", quantity: 1 });
ok(r.status === 403, "only the couple adds registry items");
r = await call(couple, "/api/guests/registry", { weddingId: wid, title: "Brass lamp", quantity: 1 });
ok(r.status === 200 && r.json.summary.registry.length === 1, "couple adds a registry item (quantity 1)");
const itemId = r.json.summary.registry[0].id;

// RSVPs: per function. A household RSVP adds four plates and one return hamper.
r = await call(null, "/api/guest/rsvp", { code: priya, functionId: sangeet.id, attendance: "yes", plates: 4, hampers: 1, meal: "veg" });
ok(r.status === 200 && r.json.page.functions.find((f) => f.id === sangeet.id).rsvp.plates === 4, "Priya RSVPs yes to the Sangeet with four plates");
await call(null, "/api/guest/rsvp", { code: rohan, functionId: ceremony.id, attendance: "yes", plates: 2, meal: "jain" });
r = await call(couple, `/api/guests?wedding=${wid}`);
let tot = r.json.summary.totals;
ok(tot[sangeet.id].plates === 4 && tot[sangeet.id].hampers === 1 && tot[sangeet.id].meals.veg === 4, "Sangeet totals: 4 plates, 1 hamper, 4 veg");
ok(tot[ceremony.id].plates === 2 && tot[ceremony.id].meals.jain === 2, "Ceremony totals: 2 plates (jain)");
await call(null, "/api/guest/rsvp", { code: priya, functionId: sangeet.id, attendance: "yes", plates: 3, hampers: 1, meal: "veg" });
r = await call(couple, `/api/guests?wedding=${wid}`);
ok(r.json.summary.totals[sangeet.id].plates === 3 && r.json.summary.totals[ceremony.id].plates === 2, "changing one RSVP updates that function only");

// The last registry item: two guests ask at the same moment; exactly one gets it.
const [ra, rb] = await Promise.all([
  call(null, "/api/guest/reserve", { code: priya, itemId }),
  call(null, "/api/guest/reserve", { code: zoya, itemId }),
]);
const statuses = [ra.status, rb.status].sort();
ok(statuses[0] === 200 && statuses[1] === 409, `two guests, one last item: exactly one wins (got ${ra.status}/${rb.status})`);
const loser = ra.status === 409 ? ra : rb;
ok(loser.json.error === "sold_out", "the other guest is told it is sold out");

// Privacy: a guest sees availability and their own reservation, never others', never the family's private data.
const winnerCode = ra.status === 200 ? priya : zoya;
const otherCode = ra.status === 200 ? zoya : priya;
r = await call(null, `/api/guest?code=${winnerCode}`);
ok(r.json.page.registry[0].mine === true && r.json.page.registry[0].remaining === 0, "the winner sees it as theirs");
r = await call(null, `/api/guest?code=${otherCode}`);
const text = JSON.stringify(r.json);
ok(r.json.page.registry[0].mine === false && r.json.page.registry[0].remaining === 0, "the other guest sees it as taken, not who took it");
ok(!text.includes("Priya") || otherCode === priya, "a guest never sees another guest's name");
ok(!text.includes("1500000") && !text.includes("12 lakh") && !text.includes("PRIVATE"), "no budget or household-private note reaches a guest");
r = await call(couple, `/api/guests?wedding=${wid}`);
ok(r.json.summary.registry[0].reservedBy.length === 1, "the family sees who reserved the gift");

// Giving a reservation back frees it for someone else.
r = await call(null, "/api/guest/release", { code: winnerCode, itemId });
ok(r.status === 200 && r.json.page.registry[0].remaining === 1 && r.json.page.registry[0].mine === false, "the winner gives the gift back");
r = await call(null, "/api/guest/reserve", { code: otherCode, itemId });
ok(r.status === 200 && r.json.page.registry[0].mine === true, "the other guest can now reserve it");
r = await call(null, "/api/guest/release", { code: winnerCode, itemId });
ok(r.status === 200, "releasing something you don't hold changes nothing");
r = await call(null, `/api/guest?code=${otherCode}`);
ok(r.json.page.registry[0].mine === true, "another guest's release cannot take away my reservation");
