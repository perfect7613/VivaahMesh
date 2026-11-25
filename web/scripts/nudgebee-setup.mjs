// Legacy inline recovery only. For the Azure worker import ops/nudgebee/*.json (docs/nudgebee-workflows.md).
// In NudgeBee, configure the shared Secret VIVAAHMESH_OPS_SECRET to match the web app.
//   set -a; . ./.env.local; set +a; node scripts/nudgebee-setup.mjs [https://vivaahmesh.vercel.app]
// Flow: event vivaahmesh_call_result_stuck (or Run) → check state (dry run) → human approval →
//       POST /api/ops/recover: Flagsmith result_processing_paused OFF, replay stored answers once. Never dials.
if (process.env.CALL_RESULT_PROCESSOR === "worker") throw new Error("Use docs/nudgebee-workflows.md for worker mode");
const BASE = process.argv[2] ?? "https://vivaahmesh.vercel.app";
const NB = "https://app.nudgebee.com/api/rpc";
const rpc = async (method, params) => {
  const r = await fetch(NB, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NUDGEBEE_API_KEY}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
};
const account = process.env.NUDGEBEE_ACCOUNT_ID || (await rpc("accounts_list", {})).rows.find((a) => a.status === "active")?.id;
if (!account) throw new Error("Set NUDGEBEE_ACCOUNT_ID to the account that receives call incidents");
const headers = { "content-type": "application/json", "x-ops-secret": "{{ Secrets.VIVAAHMESH_OPS_SECRET }}" };
const out = await rpc("workflow_create", {
  request: {
    account_id: account,
    workflow: {
      name: "vivaahmesh-call-result-recovery",
      description: "When a venue call answer is saved but not applied, check state, wait for a human approval, then turn result_processing_paused off and replay the stored answers exactly once. Never dials.",
      status: "active",
      definition: {
        timeout: "30m",
        triggers: [
          { type: "event", params: { filter: '{{ event.event_type == "vivaahmesh_call_result_stuck" }}' } },
          { type: "manual", params: {} },
        ],
        tasks: [
          { id: "check_state", type: "integrations.http", params: { url: `${BASE}/api/ops/recover`, method: "POST", headers, body: '{"dryRun":true}', timeout: "30s" } },
          {
            id: "approve_recovery", type: "core.approval", depends_on: ["check_state"], timeout: "25m",
            params: {
              message: "VivaahMesh: a venue's answer is stored but not applied to the families' plan. Approve to turn the Flagsmith kill switch result_processing_paused OFF and replay stored answers once. No phone call is made.",
              approval_type: "in_app", approval_options: ["approve", "reject"],
            },
          },
          {
            id: "recover", type: "integrations.http", depends_on: ["approve_recovery"], if: "{{ Tasks['approve_recovery'].output.status == 'approve' }}",
            params: { url: `${BASE}/api/ops/recover`, method: "POST", headers, body: "{}", timeout: "110s" },
          },
        ],
      },
    },
  },
});
console.log("workflow", out.id);
