// End-to-end check of revision-bound approval (issue #5) against a deployment, with signed initData.
// Needs the 20261125120000_approvals.sql migration applied.
// Usage (from web/): set -a; . ./.env.local; set +a; node scripts/e2e-approvals.mjs https://<deployment>
// Creates a test wedding with fake Telegram users; delete it afterwards (the script prints its id).
import crypto from "node:crypto";

const BASE = process.argv[2];
if (!BASE) throw new Error("usage: node scripts/e2e-approvals.mjs <base-url>");
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
const t = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

// Fresh fake users per run, so reruns never collide with an earlier test wedding.
const base = 910000000 + Math.floor(Math.random() * 1_000_000) * 10;
const couple = { id: base + 1, first_name: "Meera", language_code: "mr" };
const aai = { id: base + 2, first_name: "Aai", language_code: "mr" };
const riya = { id: base + 3, first_name: "Riya", language_code: "hi" };

// Setup: wedding, both households joined, demo Sangeet seeded.
let r = await call(couple, "/api/weddings", {
  partnerA: "Meera", partnerB: "Aarav", functions: ["sangeet"], myFamily: "Patil family", otherFamily: "Deshmukh family", language: "mr",
});
ok(r.status === 200, "couple creates wedding");
const v = r.json.view;
const wid = v.wedding.id;
console.log(`      test wedding id: ${wid}`);
const patil = v.households.find((h) => h.side === "A");
const deshmukh = v.households.find((h) => h.side === "B");
await call(aai, "/api/join", { code: patil.inviteCode, displayName: "Aai", role: "parent", language: "mr", priorities: [], visibility: "shared" });
await call(riya, "/api/join", { code: deshmukh.inviteCode, displayName: "Riya", role: "cousin", language: "hi", priorities: [], visibility: "shared" });
r = await call(couple, "/api/plan", { weddingId: wid });
ok(r.status === 200 && r.json.plan?.revision >= 1, "demo plan seeded and recorded as a revision");

// Only the couple can record a confirmed fact by hand; a family member can report a claim.
r = await call(aai, "/api/facts", { weddingId: wid, kind: "music_cutoff", functionKind: "sangeet", value: t("23:59"), wording: "trust me" });
ok(r.status === 403 && r.json.error === "couple_only_confirmed", "family member cannot confirm a fact");
r = await call(aai, "/api/facts", { weddingId: wid, kind: "music_cutoff", functionKind: "sangeet", value: t("23:59"), status: "conditional", wording: "I think late" });
ok(r.status === 200, "family member can report a conditional fact");
r = await call(couple, "/api/facts", { weddingId: wid, kind: "music_cutoff", functionKind: "haldi", value: t("22:00") });
ok(r.status === 400 && r.json.error === "unknown_function", "fact for a function with no activities refused");

// Simultaneous facts of the same kind must not contradict each other.
await Promise.all([
  call(couple, "/api/facts", { weddingId: wid, kind: "overtime_rate", functionKind: "sangeet", value: 5000 }),
  call(couple, "/api/facts", { weddingId: wid, kind: "overtime_rate", functionKind: "sangeet", value: 7000 }),
]);
r = await call(couple, `/api/plan?wedding=${wid}`);
ok(!r.json.plan.result.blocking.some((b) => b.code === "contradiction"), "two simultaneous facts leave no contradiction behind");

// Vendor answers that leave a feasible after-dinner slot (22:00–22:20) under the default policy.
await call(couple, "/api/facts", { weddingId: wid, kind: "music_cutoff", functionKind: "sangeet", value: t("22:30"), wording: "music till 10:30" });
r = await call(couple, "/api/facts", { weddingId: wid, kind: "coverage_end", functionKind: "sangeet", value: t("22:30"), wording: "video till 10:30" });
let plan = r.json.plan;
const rev1 = plan.revision;
const target = plan.result.proposals[0];
ok(!!target, `revision ${rev1} has an approvable proposal${target ? ` (${target.id})` : " (none: check the compiler policy in Flagsmith)"}`);
if (!target) process.exit();

// Re-reading does not create a revision.
r = await call(riya, `/api/plan?wedding=${wid}`);
ok(r.json.plan.revision === rev1, "re-reading the same plan keeps the same revision");

// Both households respond at the same moment: both responses are kept.
const [ra, rb] = await Promise.all([
  call(aai, "/api/plan/respond", { weddingId: wid, revision: rev1, proposalId: target.id, stance: "agree" }),
  call(riya, "/api/plan/respond", { weddingId: wid, revision: rev1, proposalId: target.id, stance: "prefer_other", note: "earlier please" }),
]);
ok(ra.status === 200 && rb.status === 200, "concurrent responses from two phones both accepted");
r = await call(couple, `/api/plan?wedding=${wid}`);
ok(r.json.plan.responses.length === 2, "couple sees both households' responses");
ok(r.json.plan.responses.some((x) => x.side === "A" && x.stance === "agree") && r.json.plan.responses.some((x) => x.side === "B" && x.stance === "prefer_other"), "each response kept per household");

// A second answer from the same household replaces its first, never duplicates.
await call(aai, "/api/plan/respond", { weddingId: wid, revision: rev1, proposalId: target.id, stance: "object" });
r = await call(couple, `/api/plan?wedding=${wid}`);
ok(r.json.plan.responses.filter((x) => x.side === "A").length === 1 && r.json.plan.responses.find((x) => x.side === "A").stance === "object", "same household: latest answer wins, one row");

// Only the couple can approve.
r = await call(aai, "/api/plan/approve", { weddingId: wid, revision: rev1, proposalId: target.id });
ok(r.status === 403, "non-couple approval refused");

// A late vendor reply creates a newer revision: approving the old one is rejected with the newer plan.
r = await call(couple, "/api/facts", { weddingId: wid, kind: "overtime_rate", functionKind: "sangeet", value: 6000, wording: "₹6000/hr" });
const rev2 = r.json.plan.revision;
ok(rev2 > rev1, `late vendor reply → newer revision ${rev2}`);
r = await call(couple, "/api/plan/approve", { weddingId: wid, revision: rev1, proposalId: target.id });
ok(r.status === 409 && r.json.error === "stale" && r.json.plan?.revision === rev2, "stale approval → 409 with the newer revision");
r = await call(couple, `/api/plan?wedding=${wid}`);
ok(r.json.plan.committed === null, "stale approval committed nothing");

// Responding to the outdated revision is rejected the same way.
r = await call(riya, "/api/plan/respond", { weddingId: wid, revision: rev1, proposalId: target.id, stance: "agree" });
ok(r.status === 409 && r.json.plan?.revision === rev2, "response to an outdated revision → 409 with the newer revision");

// Approving the current revision commits the timeline.
const current = r.json.plan.result.proposals[0];
r = await call(couple, "/api/plan/approve", { weddingId: wid, revision: rev2, proposalId: current.id });
ok(r.status === 200 && r.json.plan.committed?.revision === rev2, `couple approves revision ${rev2}`);
ok(r.json.plan.committed?.approvedBy === "Meera", "approval records who approved");
const moved = current.moves[0];
const after = r.json.plan.activities.find((a) => a.id === moved.activityId);
ok(after && after.start === moved.to.start && after.end === moved.to.end, "committed timeline now has the approved move");

// It survives a refresh, for everyone.
r = await call(riya, `/api/plan?wedding=${wid}`);
ok(r.json.plan.committed?.revision === rev2 && r.json.plan.committed.recap.moves.length > 0, "approved timeline and recap survive a refresh (other household)");

// If the approved move extended video coverage, the conflict must not come straight back.
if (moved.activityId === "video") {
  r = await call(couple, `/api/plan?wedding=${wid}`);
  ok(!r.json.plan.result.conflicts.some((c) => c.constraint === "coverage_end"), "extending coverage clears the coverage conflict (coverage_end fact recorded)");
}

// Approving the same revision twice is refused.
r = await call(couple, "/api/plan/approve", { weddingId: wid, revision: rev2, proposalId: current.id });
ok(r.status === 409, "second approval of the same revision refused");

console.log("\n      Flag snapshot: check approvals.flags for this wedding in Supabase (not exposed by the API).");
