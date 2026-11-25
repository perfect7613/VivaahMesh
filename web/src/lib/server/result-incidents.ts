import "server-only";
import { db } from "./supabase";

type StalledResult = {
  call_id: string;
  finding_id: string;
  received_at: string;
};

export function incidentPayload(row: StalledResult, reason: "paused" | "failed" | "overdue") {
  const workload = "vivaahmesh-result-worker";
  const detail = {
    paused: "Processing is paused.", failed: "The most recent processing attempt failed.",
    overdue: "Processing has been pending for at least 90 seconds.",
  }[reason];
  const description = `A vendor result was saved at ${row.received_at}. ${detail} Check the worker deployment and the Flagsmith switch.`;
  return {
    event: {
      finding_id: row.finding_id, fingerprint: row.finding_id, aggregation_key: "vivaahmesh_result_processing_stalled",
      finding_type: "pending_call_result", source: "vivaahmesh", status: "FIRING", priority: "HIGH",
      title: "Saved vendor answer is awaiting processing", description,
      subject_name: workload, subject_type: "Deployment", subject_namespace: "vivaahmesh",
      starts_at: row.received_at,
      labels: { call_id: row.call_id, provider_result_id: row.finding_id, worker: workload, reason },
      evidences: [{ type: "markdown", title: "Stored result", content: description }],
    },
  };
}

// The workflow URL contains the integration token. Keep both it and the raw provider payload out of logs.
async function sendIncident(row: StalledResult, reason: "paused" | "failed" | "overdue") {
  const endpoint = process.env.NUDGEBEE_EVENT_WEBHOOK_URL;
  if (!endpoint || new URL(endpoint).protocol !== "https:") throw new Error("NudgeBee HTTPS webhook is missing");
  const response = await fetch(endpoint, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
    headers: { "content-type": "application/json" }, body: JSON.stringify(incidentPayload(row, reason)),
  });
  if (!response.ok) throw new Error(`NudgeBee webhook returned HTTP ${response.status}`);
}

export async function reportResultIncidents(callId?: string, reason: "paused" | "failed" | "overdue" = "overdue") {
  // The schedule also catches a stopped worker when the flag is off or the callback process died.
  const { data, error } = await db().rpc("claim_call_result_incidents", { p_call_id: callId ?? null });
  if (error) throw error;
  const rows = (data ?? []) as StalledResult[];
  const results = await Promise.allSettled(rows.map((row) => sendIncident(row, reason)));
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed) throw new Error(`Failed to report ${failed} pending call result(s)`);
  return { reported: rows.length };
}
