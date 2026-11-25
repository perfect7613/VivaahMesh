// End-to-end check of the vendor run sheet and budget (issue #13, first half) against a deployment.
// Needs the 20261125170000_vendors.sql migration applied, and the Flagsmith flag `stage_day_of`
// enabled for the test wedding (e.g. via the wedding_stage segment).
// Usage (from web/): set -a; . ./.env.local; set +a; node scripts/e2e-vendors.mjs https://<deployment>
// Creates a test wedding with fake Telegram users. Midway it asks an admin to move the wedding to the
// `day_of` stage (the stage is not changeable through the API yet; that is issue #11).
import crypto from "node:crypto";
import readline from "node:readline/promises";

const BASE = process.argv[2];
if (!BASE) throw new Error("usage: node scripts/e2e-vendors.mjs <base-url>");
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();

function initData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "e2e" + user.id, user: JSON.stringify(user) });
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  p.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex"));
  return p.toString();
}
// Family calls use signed Telegram initData; vendor calls use only their access link.
async function call(user, path, body) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(user ? { authorization: `tma ${initData(user)}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };

const base = 930000000 + Math.floor(Math.random() * 1_000_000) * 10;
const couple = { id: base + 1, first_name: "Meera", language_code: "mr" };
const aai = { id: base + 2, first_name: "Aai", language_code: "mr" };

// Setup: wedding (three functions), a private budget, and Aai in the Patil family.
let r = await call(couple, "/api/weddings", {
  partnerA: "Meera", partnerB: "Aarav", functions: ["sangeet", "ceremony", "reception"], myFamily: "Patil family", otherFamily: "Deshmukh family", language: "mr",
  budgetInr: 1500000,
});
ok(r.status === 200, "couple creates wedding");
const v = r.json.view;
const wid = v.wedding.id;
await call(aai, "/api/join", { code: v.households.find((h) => h.side === "A").inviteCode, displayName: "Aai", role: "parent", language: "mr", priorities: [], note: "PRIVATE: budget under 12 lakh", visibility: "household" });
console.log(`      test wedding id: ${wid}`);

// While the wedding is still in the brief stage, vendors are locked, for families and vendors.
r = await call(couple, `/api/vendors?wedding=${wid}`);
ok(r.status === 403 && r.json.error === "stage_locked", "family vendor area locked before the day-of stage");
r = await call(null, "/api/vendor?code=doesnotexist");
ok(r.status === 404, "unknown vendor code → 404");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(`\n      Admin step: move this wedding to the day_of stage, and make sure stage_day_of is on:\n        update weddings set stage = 'day_of' where id = '${wid}';\n`);
await rl.question("      Press Enter once done… ");
rl.close();

// Only the couple loads sample vendors; it is safe to press twice.
r = await call(aai, "/api/vendors/seed", { weddingId: wid });
ok(r.status === 403, "only the couple loads sample vendors");
r = await call(couple, "/api/vendors/seed", { weddingId: wid });
ok(r.status === 200 && r.json.vendors.vendors.length === 3, "couple loads three sample vendors");
r = await call(couple, "/api/vendors/seed", { weddingId: wid });
ok(r.status === 200 && r.json.vendors.vendors.length === 3, "loading the samples twice adds nothing");
const sum = r.json.vendors;
ok(sum.vendors.every((x) => x.source === "seed"), "sample vendors are labelled as sample data");
const caterer = sum.vendors.find((x) => x.category === "caterer");
const photographer = sum.vendors.find((x) => x.category === "photographer");
const decorator = sum.vendors.find((x) => x.category === "decorator");

// Budget: the photographer's package covers all three functions but counts once.
ok(photographer.bookings.length === 1 && photographer.bookings[0].items.length === 3, "the photographer's package spans three functions as one booking");
ok(sum.budget.committedInr === 720000, `committed = 4,20,000 + 3,00,000, the package counted once (got ${sum.budget.committedInr})`);
ok(sum.budget.pricePending === 1 && sum.budget.plannedInr === 0, "the unpriced decor proposal is pending, not zero");

// Prices and the budget are the couple's: a parent gets neither, in the response itself.
r = await call(aai, `/api/vendors?wedding=${wid}`);
ok(r.status === 200 && r.json.vendors.budget === null, "a parent gets no budget summary");
const aaiText = JSON.stringify(r.json);
ok(!aaiText.includes("420000") && !aaiText.includes("300000") && !aaiText.includes("1500000"), "no prices or budget in a parent's response");
ok(r.json.vendors.vendors.every((x) => x.accessCode === null), "a parent cannot see vendors' access links");

// The vendor's page: only their own approved items, no prices, no other vendors.
r = await call(null, `/api/vendor?code=${caterer.accessCode}`);
ok(r.status === 200 && r.json.page.items.length === 1, "the caterer sees one approved item");
let text = JSON.stringify(r.json);
ok(!text.includes("Lens Studio") && !text.includes("Bloom") && !text.includes("Marigold"), "the caterer sees nothing of other vendors");
ok(!text.includes("420000") && !text.includes("300000") && !text.includes("1500000") && !text.includes("PRIVATE") && !text.includes("12 lakh"), "no price, budget or private note in a vendor's page");
ok(r.json.page.sample === true && !!r.json.page.contact, "the page is labelled sample data and shows the on-ground contact");

r = await call(null, `/api/vendor?code=${photographer.accessCode}`);
ok(r.status === 200 && r.json.page.items.length === 3, "the photographer sees all three functions of their package");

// A proposed booking with an unapproved item shows nothing; sharing alone is not enough until confirmed.
r = await call(null, `/api/vendor?code=${decorator.accessCode}`);
ok(r.status === 200 && r.json.page.items.length === 0, "the decorator (proposed, unshared) sees nothing yet");
const item = decorator.bookings[0].items[0];
r = await call(couple, "/api/vendors/approve", { weddingId: wid, bookingId: decorator.bookings[0].id, functionId: item.functionId, approved: true, brief: "Marigold arches", arrivalTime: "09:00" });
ok(r.status === 200, "couple approves the decor item");
r = await call(null, `/api/vendor?code=${decorator.accessCode}`);
ok(r.json.page.items.length === 0, "an approved item of a still-proposed booking stays hidden");

// Sharing is reversible, and only the couple controls it.
const cItem = caterer.bookings[0].items[0];
r = await call(aai, "/api/vendors/approve", { weddingId: wid, bookingId: caterer.bookings[0].id, functionId: cItem.functionId, approved: false });
ok(r.status === 403, "only the couple shares or hides items");
await call(couple, "/api/vendors/approve", { weddingId: wid, bookingId: caterer.bookings[0].id, functionId: cItem.functionId, approved: false });
r = await call(null, `/api/vendor?code=${caterer.accessCode}`);
ok(r.json.page.items.length === 0, "hiding an item removes it from the vendor's page");
await call(couple, "/api/vendors/approve", { weddingId: wid, bookingId: caterer.bookings[0].id, functionId: cItem.functionId, approved: true });

// A new package over two functions is added once and counted once.
r = await call(couple, "/api/vendors", { weddingId: wid, name: "Beat Makers", category: "musician" });
ok(r.status === 200 && !!r.json.vendorId, "couple adds a vendor");
const fns = r.json.vendors.functions;
r = await call(couple, "/api/vendors/booking", { weddingId: wid, vendorId: r.json.vendorId, title: "Sangeet and reception DJ", totalInr: 80000, status: "confirmed", functionIds: [fns[0].id, fns[2].id, fns[0].id] });
ok(r.status === 200 && r.json.vendors.budget.committedInr === 800000, `a two-function package adds 80,000 once (got ${r.json.vendors.budget.committedInr})`);
