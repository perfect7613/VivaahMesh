// Creates (or reuses) the VivaahMesh Flagsmith project: environments, every control-plane flag
// from the PRD, segments and segment overrides. Writes the server-side key into .env.local.
// Usage (from web/): FLAGSMITH_ADMIN_API_KEY=... node scripts/flagsmith-setup.mjs
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const API = "https://api.flagsmith.com/api/v1";
const KEY = process.env.FLAGSMITH_ADMIN_API_KEY;
if (!KEY) throw new Error("FLAGSMITH_ADMIN_API_KEY missing");
const H = { Authorization: `Api-Key ${KEY}`, "content-type": "application/json" };

async function api(method, path, body) {
  const res = await fetch(API + path, { method, redirect: "error", signal: AbortSignal.timeout(15000), headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) {
    const err = new Error(`Flagsmith rejected ${method} (HTTP ${res.status})`);
    err.duplicate = (res.status === 400 || res.status === 409) && /already|exists|unique/i.test(text);
    throw err;
  }
  return json;
}
const list = (x) => (Array.isArray(x) ? x : x.results ?? []);

export const DEFAULT_COMPILER_POLICY = {
  version: "v1",
  strategy: "preserve_family_priorities",
  makeupBufferMin: 15,
  setupBufferMin: 10,
  maxProposals: 3,
  allowDanceDuringDinner: false,
};

// name, description, default enabled, default value, (optional) multivariate options
const FEATURES = [
  ["compiler_policy", "Remote config for the deterministic compiler: ranking strategy, buffers, max proposals.", true, JSON.stringify(DEFAULT_COMPILER_POLICY)],
  ["caller_prompt", "Samvaad caller script variant, pinned per call at creation.", true, "baseline", [["clarify_scope", 50]]],
  ["voice_channel", "Where vendor calls run: phone (Samvaad outbound) or browser (fallback).", true, "phone"],
  ["outbound_dialing_enabled", "Kill switch. While off, no vendor call is ever dialed.", false, null],
  ["result_processing_paused", "Kill switch. Results are stored but not applied while on. NudgeBee flips it off on recovery.", false, null],
  ["whatsapp_bridge_enabled", "Lets a household's WhatsApp group feed the plan (rolled out per household).", false, null],
  ["voice_recap_bulbul", "Bulbul reads the approved recap aloud (rolled out to Marathi speakers first).", false, null],
  ["conditional_options_ui", "Shows conditional proposals with the missing answer (rolled out to Household A first).", false, null],
  ["onboarding_celebration", "Marigold petals and haptics when a wedding is created or a family joins.", true, null],
  ["home_team_section", "Shows 'The team is handling' on the Mini App home screen.", true, null],
  ["agent_enabled", "Kill switch for the always-on VivaahMesh agent (heartbeat and replies).", true, null],
  ["agent_model", "Which Sarvam Token Factory model powers the agent.", true, "glm5.3-flash"],
  ["stage_sourcing", "Unlocks vendor sourcing screens.", false, null],
  ["stage_booking", "Unlocks booking and deposit screens.", false, null],
  ["stage_guests", "Unlocks RSVPs and the registry.", false, null],
  ["stage_day_of", "Unlocks the run sheet and on-ground checklist.", false, null],
  ["stage_closeout", "Unlocks reconciliation and closeout.", false, null],
];

const LATER = ["sourcing", "booking", "guests", "day_of", "closeout"];
const SEGMENTS = [
  ["marathi_speakers", [["language", "EQUAL", "mr"]], { voice_recap_bulbul: true }],
  ["household_a", [["household_side", "EQUAL", "A"]], { conditional_options_ui: true, whatsapp_bridge_enabled: true }],
  ["stage_sourcing_plus", [["wedding_stage", "IN", LATER.join(",")]], { stage_sourcing: true }],
  ["stage_booking_plus", [["wedding_stage", "IN", LATER.slice(1).join(",")]], { stage_booking: true }],
  ["stage_guests_plus", [["wedding_stage", "IN", LATER.slice(2).join(",")]], { stage_guests: true }],
  ["stage_day_of_plus", [["wedding_stage", "IN", LATER.slice(3).join(",")]], { stage_day_of: true }],
  ["stage_closeout", [["wedding_stage", "EQUAL", "closeout"]], { stage_closeout: true }],
];

const orgs = list(await api("GET", "/organisations/"));
const org = orgs[0];
let project = list(await api("GET", `/projects/?organisation=${org.id}`)).find((p) => p.name === "VivaahMesh");
if (!project) project = await api("POST", "/projects/", { name: "VivaahMesh", organisation: org.id });
console.log(`project ${project.id} (${org.name})`);

const envs = {};
for (const name of ["Development", "Production"]) {
  let env = list(await api("GET", `/environments/?project=${project.id}`)).find((e) => e.name === name);
  if (!env) env = await api("POST", "/environments/", { name, project: project.id });
  envs[name] = env;
}

const existing = list(await api("GET", `/projects/${project.id}/features/?page_size=100`));
const features = {};
for (const [name, description, enabled, value, mv] of FEATURES) {
  let f = existing.find((x) => x.name === name);
  if (!f) {
    f = await api("POST", `/projects/${project.id}/features/`, {
      name, description, default_enabled: enabled, initial_value: value, type: mv ? "MULTIVARIATE" : "STANDARD",
      multivariate_options: (mv ?? []).map(([v, pct]) => ({ type: "unicode", key: v, string_value: v, default_percentage_allocation: pct })),
    });
  }
  features[name] = f;
}
console.log(`features: ${Object.keys(features).length}`);

const existingSegs = list(await api("GET", `/projects/${project.id}/segments/?page_size=100`));
for (const [name, conds, overrides] of SEGMENTS) {
  let seg = existingSegs.find((s) => s.name === name);
  if (!seg) {
    seg = await api("POST", `/projects/${project.id}/segments/`, {
      name, project: project.id,
      rules: [{ type: "ALL", rules: [{ type: "ANY", conditions: conds.map(([property, operator, value]) => ({ property, operator, value })) }] }],
    });
  }
  for (const env of Object.values(envs)) {
    for (const [feature, enabled] of Object.entries(overrides)) {
      // Environments use v2 feature versioning: overrides are published as a new feature version.
      try {
        await api("POST", `/environments/${env.id}/features/${features[feature].id}/versions/`, {
          publish_immediately: true,
          feature_states_to_create: [
            { feature_segment: { segment: seg.id }, enabled, feature_state_value: { type: "unicode", string_value: null } },
          ],
        });
      } catch (e) {
        // Re-runs hit "override already exists": safe to ignore.
        if (!e.duplicate) throw e;
      }
    }
  }
}
console.log(`segments: ${SEGMENTS.length}`);

// Server-side keys (never sent to the browser) → .env.local
const serverKeys = {};
for (const [name, env] of Object.entries(envs)) {
  const keys = list(await api("GET", `/environments/${env.api_key}/api-keys/`));
  const k = keys.find((x) => x.name === "vivaahmesh-server") ?? (await api("POST", `/environments/${env.api_key}/api-keys/`, { name: "vivaahmesh-server" }));
  serverKeys[name] = k.key;
}
let dotenv = readFileSync(".env.local", "utf8").replace(/^FLAGSMITH_(SERVER_KEY|SERVER_KEY_PRODUCTION)=.*\n?/gm, "");
dotenv += `FLAGSMITH_SERVER_KEY=${serverKeys.Development}\nFLAGSMITH_SERVER_KEY_PRODUCTION=${serverKeys.Production}\n`;
chmodSync(".env.local", 0o600);
writeFileSync(".env.local", dotenv);
console.log("wrote FLAGSMITH_SERVER_KEY (dev) and FLAGSMITH_SERVER_KEY_PRODUCTION to .env.local");
