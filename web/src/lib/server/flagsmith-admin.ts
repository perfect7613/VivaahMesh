import "server-only";

/**
 * Flagsmith Admin API, server only: used by the recovery endpoint to turn the
 * `result_processing_paused` kill switch off. Environments use v2 feature versioning, so a change
 * is published as a new feature version (same as scripts/flag.mjs).
 */
const API = "https://api.flagsmith.com/api/v1";

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.FLAGSMITH_ADMIN_API_KEY;
  if (!key) throw new Error("FLAGSMITH_ADMIN_API_KEY missing");
  const r = await fetch(API + path, {
    method,
    headers: { authorization: `Api-Key ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`flagsmith ${method} ${path} → ${r.status} ${t.slice(0, 200)}`);
  return (t ? JSON.parse(t) : {}) as T;
}
type List<T> = T[] | { results: T[] };
const rows = <T,>(x: List<T>) => (Array.isArray(x) ? x : x.results);

export async function setFlagEnabled(name: string, enabled: boolean, envName = process.env.FLAGSMITH_ENV_NAME || "Production") {
  const org = rows(await api<List<{ id: number }>>("GET", "/organisations/"))[0];
  const project = rows(await api<List<{ id: number; name: string }>>("GET", `/projects/?organisation=${org.id}`)).find((p) => p.name === "VivaahMesh");
  if (!project) throw new Error("flagsmith project not found");
  const env = rows(await api<List<{ id: number; name: string }>>("GET", `/environments/?project=${project.id}`)).find((e) => e.name === envName);
  const feature = rows(await api<List<{ id: number; name: string }>>("GET", `/projects/${project.id}/features/?search=${name}`)).find((f) => f.name === name);
  if (!env || !feature) throw new Error(`flagsmith ${envName}/${name} not found`);
  await api("POST", `/environments/${env.id}/features/${feature.id}/versions/`, {
    publish_immediately: true,
    feature_states_to_update: [{ feature_segment: null, enabled }],
  });
  return { env: env.name, feature: name, enabled };
}
