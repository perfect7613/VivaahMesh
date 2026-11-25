// Flip a Flagsmith flag live (Production by default). Used on stage and by the NudgeBee runbook.
//   node scripts/flag.mjs outbound_dialing_enabled on
//   node scripts/flag.mjs result_processing_paused off
//   node scripts/flag.mjs compiler_policy strategy=lowest_confirmed_cost allowDanceDuringDinner=true
//   node scripts/flag.mjs agent_model glm5.3
//   ENV=Development node scripts/flag.mjs ...
// Environments use v2 feature versioning, so each change is published as a new feature version.
const API = "https://api.flagsmith.com/api/v1";
const KEY = process.env.FLAGSMITH_ADMIN_API_KEY;
if (!KEY) throw new Error("FLAGSMITH_ADMIN_API_KEY missing");
const H = { Authorization: `Api-Key ${KEY}`, "content-type": "application/json" };
const api = async (method, path, body) => {
  const r = await fetch(API + path, { method, redirect: "error", signal: AbortSignal.timeout(15000), headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`Flagsmith rejected ${method} (HTTP ${r.status})`);
  return t ? JSON.parse(t) : {};
};
const list = (x) => (Array.isArray(x) ? x : x.results ?? []);

const [name, ...rest] = process.argv.slice(2);
if (!name) throw new Error("usage: node scripts/flag.mjs <feature> [on|off|value|key=value…]");

const org = list(await api("GET", "/organisations/"))[0];
const project = list(await api("GET", `/projects/?organisation=${org.id}`)).find((p) => p.name === "VivaahMesh");
const env = list(await api("GET", `/environments/?project=${project.id}`)).find((e) => e.name === (process.env.ENV ?? "Production"));
const feature = list(await api("GET", `/projects/${project.id}/features/?search=${name}`)).find((f) => f.name === name);
if (!feature) throw new Error(`no feature ${name}`);

const versions = list(await api("GET", `/environments/${env.id}/features/${feature.id}/versions/`));
const live = versions.find((v) => v.is_live) ?? versions[0];
const states = await api("GET", `/environments/${env.id}/features/${feature.id}/versions/${live.uuid}/featurestates/`);
const current = states.find((s) => !s.feature_segment);

let enabled = current.enabled;
const raw = current.feature_state_value;
let value = raw && typeof raw === "object" ? (raw.string_value ?? raw.integer_value ?? raw.boolean_value ?? null) : (raw ?? null);
if (rest[0] === "on" || rest[0] === "off") enabled = rest[0] === "on";
else if (rest.length && rest.every((r) => r.includes("="))) {
  const obj = value ? JSON.parse(value) : {};
  for (const kv of rest) {
    const [k, v] = kv.split("=");
    obj[k] = v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) ? Number(v) : v;
  }
  const n = /^v(\d+)$/.exec(String(obj.version ?? ""));
  obj.version = n ? `v${Number(n[1]) + 1}` : "v2";
  value = JSON.stringify(obj);
} else if (rest.length) value = rest.join(" ");

await api("POST", `/environments/${env.id}/features/${feature.id}/versions/`, {
  publish_immediately: true,
  feature_states_to_update: [{ feature_segment: null, enabled, feature_state_value: { type: "unicode", string_value: value } }],
});
console.log(`${env.name} · ${name}: ${enabled ? "on" : "off"}${value != null ? ` · ${value}` : ""}`);
