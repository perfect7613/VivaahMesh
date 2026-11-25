# NudgeBee call result recovery

Use the NudgeBee account for the Azure Kubernetes cluster that hosts the [VivaahMesh result worker](result-worker.md). Check that the cluster's Deployments appear in NudgeBee and select that account for all three automations. The VivaahMesh web service and NudgeBee scheduler need to remain reachable while the result worker is stopped. Keep the Deployment at one replica during normal operation.

## Configure the account

| Kind | Name | Value |
| --- | --- | --- |
| Config | `VIVAAHMESH_BASE_URL` | Reachable HTTPS web app origin with no trailing slash. The HTTP action needs a hostname that resolves to a public address. |
| Config | `FLAGSMITH_ENVIRONMENT_ID` | Numeric Flagsmith environment ID for the web app and worker's server key. |
| Config | `FLAGSMITH_RESULT_PROCESSING_PAUSED_FEATURE_ID` | Numeric Flagsmith feature ID for `result_processing_paused` in the VivaahMesh project. |
| Secret | `VIVAAHMESH_OPS_SECRET` | The deployed web app's `OPS_SECRET`. |
| Secret | `FLAGSMITH_ADMIN_API_KEY` | Flagsmith administrative key with permission to publish the feature version in the chosen environment. |

The Flagsmith IDs are the IDs used in the management API run by [`web/scripts/flag.mjs`](../web/scripts/flag.mjs). The pause flag is boolean and was created with a null feature value. The workflow publishes a new live version with only the default pause state disabled and the value still null. Grant the NudgeBee cluster integration access to get, list, watch and patch `vivaahmesh-result-worker` Deployments and get and patch its `deployments/scale` subresource in the `vivaahmesh` namespace. The integration must permit the approved scale command and rollout status check against that Deployment.

In **Settings → Integrations**, create an Automation Webhook integration named `vivaahmesh-result-incidents`. In **Automations → Create Automation**, select the cluster account and use **Create from Code** with each JSON definition below. Set each automation's name, validate, publish and set its version live. In the Store automation, reselect the webhook integration in the canvas if the saved binding is missing. Copy the generated authenticated URL directly into `NUDGEBEE_EVENT_WEBHOOK_URL` in the web app's secret settings. NudgeBee authenticates that endpoint using the URL token. [Workflow Builder](https://docs.nudgebee.com/docs/features/workflow-builder/), [Automation Webhook](https://docs.nudgebee.com/docs/integrations/Webhooks/automation_webhook/)

## Canvas reference

| Automation | Trigger | Steps |
| --- | --- | --- |
| Store VivaahMesh result incident | Authenticated webhook, filtered to VivaahMesh stalled-result events | Store Event passes `Inputs.webhook_json.event` as an object and requests automatic AI investigation. NudgeBee deduplicates by the provider result ID in `finding_id`. [Definition](../ops/nudgebee/store-result-incident.json) |
| Recover VivaahMesh result worker | `investigation.completed`, filtered to the worker and event type | In-app Approval → publish the Flagsmith pause flag off → restart the named Deployment → restore one replica → wait for rollout → POST one call ID to replay → resolve the original finding. The recovery steps each require the exact `approve` decision and Kubernetes actions also require a successful Flagsmith HTTP response. [Definition](../ops/nudgebee/recover-result-worker.json) |
| Scan VivaahMesh result incidents | Every minute in UTC, skip overlapping runs | POST `/api/calls/incidents` using the ops secret. This automation runs independently of the result worker. [Definition](../ops/nudgebee/scan-result-incidents.json) |

The recovery trigger's lifecycle phase lives in JSON. Confirm `params.on` still reads `investigation.completed` after editing the canvas. If investigation fails, inspect the event and restore its investigation before expecting an approval. Kubernetes steps use the workflow's own cluster account and fixed resource names. Replay passes only `Inputs.event.labels.call_id`. [Trigger settings](https://docs.nudgebee.com/docs/features/workflow-builder/triggers/), [Event actions](https://docs.nudgebee.com/docs/features/workflow-builder/event-tasks/), [Core actions](https://docs.nudgebee.com/docs/features/workflow-builder/core-tasks/), [Kubectl action](https://docs.nudgebee.com/docs/features/workflow-builder/cloud-cli-tasks/#cloudk8scli--k8scli)

## Rehearse in the Azure staging environment

1. Use a rehearsal Flagsmith environment, app URL, webhook and Kubernetes account. Validate the imports in that NudgeBee account before publishing. NudgeBee Dry Run can execute external calls, so only test these definitions against rehearsal resources. [Dry Run & Validation](https://docs.nudgebee.com/docs/features/workflow-builder/workflow-dry-run-validation/)
2. Turn `result_processing_paused` on, save a provider result and stop the result worker by scaling it to zero. Wait for the scheduled scan and confirm NudgeBee displays the stalled-result event with the correct call ID, evidence and investigation. Deliver the same provider result again and confirm the event remains a single row.
3. With approval pending, confirm the flag stays on, the worker stays stopped and replay has no execution. Reject one rehearsal run and check that the remaining steps are skipped. To exercise approval, use a fresh incident with a new provider result ID so that deduplication does not reuse the rejected event.
4. Review a fresh investigation, verify the incident remains relevant and approve its recovery. Check the Flagsmith response, Deployment rollout and replay response. Replay can return success for an already-processed result if the recovered worker got there first. A `superseded` response preserves an older answer underneath a newer confirmation. A `409` means processing is still paused and a `404` means the call has no saved result. Inspect failures before rerunning since the new run may publish a feature version and restart the worker again.
5. Verify the app shows one completed call, one applied fact and one new plan revision on both household screens. Check that the provider's outbound call count did not change.

Workflow definitions can be checked locally. The account binding, credentials, cluster access, NudgeBee's investigation result and full cross-service rehearsal require a live rehearsal environment.
