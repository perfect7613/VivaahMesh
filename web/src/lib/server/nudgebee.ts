import "server-only";

/**
 * NudgeBee: operational events for the parts of VivaahMesh that can get stuck.
 *  - a venue call result stored but not applied (result_processing_paused on, or processing failed)
 *  - the always-on agent failing
 * Events go through NudgeBee's `events.store` task (JSON-RPC, Bearer API token). The dedup key is
 * `finding_id`, so a duplicate Sarvam callback updates the same event instead of opening a second.
 * Reporting never throws: an ops outage must not break a family's plan.
 */

const BASE = process.env.NUDGEBEE_BASE_URL || "https://app.nudgebee.com";

async function rpc<T>(method: string, params: Record<string, unknown>): Promise<T | null> {
  const key = process.env.NUDGEBEE_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`${BASE}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json().catch(() => ({}))) as { result?: T; error?: { message: string } };
    if (j.error) console.error(`nudgebee ${method}`, j.error.message);
    return j.result ?? null;
  } catch (e) {
    console.error(`nudgebee ${method} failed`, e);
    return null;
  }
}

let accountId: string | null = process.env.NUDGEBEE_ACCOUNT_ID || null;
async function account() {
  if (accountId) return accountId;
  const r = await rpc<{ rows: { id: string; status: string }[] }>("accounts_list", {});
  accountId = r?.rows.find((a) => a.status === "active")?.id ?? r?.rows[0]?.id ?? null;
  return accountId;
}

export interface NbEvent {
  findingId: string;
  title: string;
  description: string;
  aggregationKey: string;
  status?: "FIRING" | "RESOLVED";
  priority?: "DEBUG" | "INFO" | "LOW" | "MEDIUM" | "HIGH";
  subject?: string;
  labels?: Record<string, string>;
  evidence?: string;
  analyse?: boolean;
}

/** Stores (or, for a known finding_id, updates) one event. Returns NudgeBee's event id. */
export async function reportEvent(e: NbEvent): Promise<string | null> {
  const acc = await account();
  if (!acc) return null;
  const out = await rpc<{ result: string | null; status: string; error?: string }>("workflow_execute_task", {
    account_id: acc,
    task_type: "events.store",
    params: {
      trigger_notification_im: e.priority === "HIGH",
      trigger_ai_analysis: e.analyse ?? e.priority === "HIGH",
      event: {
        title: e.title,
        description: e.evidence ? `${e.description}\n\nEvidence:\n${e.evidence}` : e.description,
        aggregation_key: e.aggregationKey,
        finding_id: e.findingId,
        finding_type: e.aggregationKey,
        subject_name: e.subject ?? "vivaahmesh-web",
        subject_type: "service",
        subject_namespace: "vivaahmesh",
        status: e.status ?? "FIRING",
        priority: e.priority ?? "MEDIUM",
        source: "automation",
        category: "application",
        labels: { app: "vivaahmesh", ...(e.labels ?? {}) },
        starts_at: new Date().toISOString(),
      },
    },
  });
  if (out?.status !== "COMPLETED") {
    if (out?.error) console.error("nudgebee events.store", out.error);
    return null;
  }
  return out.result;
}

/** Marks a NudgeBee event resolved (recovery finished). */
export async function resolveEvent(eventId: string) {
  const r = await rpc<{ success: boolean }>("event_update_nb_status", { event_id: eventId, nb_status: "RESOLVED" });
  return !!r?.success;
}
