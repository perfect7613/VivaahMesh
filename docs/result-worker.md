# Run the call result worker on Azure

The Azure worker reads the same stored call results, feature switch and evidence transaction as the web app. A provider callback commits the raw result first. In worker mode it returns without applying the result. Stopping the Deployment leaves that result available to an independent NudgeBee scan and an approved replay.

## Deploy to the existing cluster

1. Apply the repository's Supabase migrations to the target environment before deploying the matching app and worker. Some voice migrations precede the family-groups migration by timestamp. For an existing Supabase project, review `supabase db push --dry-run --include-all` and apply the listed pending migrations to that project. The worker needs the same Supabase project and Flagsmith environment as the web app.
2. Build the worker image in Azure Container Registry from the repository root at the release commit. In Azure Cloud Shell, set `ACR_NAME` to your registry name and `AKS_CONTEXT` to the kubeconfig context for the NudgeBee-monitored Azure cluster. The account used by that cluster must be able to pull from the registry.

   ```sh
   release=$(git rev-parse HEAD)
   build_context=$(mktemp -d)
   git archive "$release" | tar -x -C "$build_context"
   az acr build --registry "$ACR_NAME" --image "vivaahmesh-result-worker:$release" --file ops/result-worker/Dockerfile "$build_context"
   registry=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)
   digest=$(az acr repository show --name "$ACR_NAME" --image "vivaahmesh-result-worker:$release" --query digest -o tsv)
   image="$registry/vivaahmesh-result-worker@$digest"
   ```

3. Provision the namespace `vivaahmesh` and its Secret `vivaahmesh-result-worker` through the cluster's usual secret-management process. Supply `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `FLAGSMITH_SERVER_KEY`. To process live Sarvam Analytics and deliver notifications, supply the same server-side Sarvam voice/model and Telegram delivery settings used by the web app, including `APP_URL`. Keep the Flagsmith management key in the NudgeBee recovery workflow. Only the web app needs the NudgeBee incoming webhook URL.
4. Render the Deployment with the published digest, apply to that context and wait for readiness.

   ```sh
   kubectl set image --local -f ops/result-worker/deployment.yaml "worker=$image" -o yaml |
     kubectl --context "$AKS_CONTEXT" apply -f -
   kubectl --context "$AKS_CONTEXT" -n vivaahmesh rollout status deploy/vivaahmesh-result-worker
   ```

5. Set `CALL_RESULT_PROCESSOR=worker` and `NUDGEBEE_EVENT_WEBHOOK_URL` on the web app. Configure the authenticated incident scan, investigation and approved recovery using the [NudgeBee workflows](nudgebee-workflows.md). Keep the scanner and web app running during worker incidents. The web app uses inline processing by default for deployments that have not enabled the external worker.

A worker tick leases one row. A failed attempt becomes eligible again in two minutes. Multiple attempts use the same transactional fact write. The independent scan looks for unapplied results at least 90 seconds old and retries event delivery after five minutes. A paused callback also reports immediately using the same provider result ID. Incident evidence contains operational identifiers and timestamps. The provider transcript and contact details stay in the application database.

## Verify before a live demo

Run `web/tests/recovery.sh` after installing the web dependencies, with PostgreSQL and PostgREST on the test runner's PATH. It starts a disposable database and API. Use the staging checklist in the workflow guide for NudgeBee's investigation, human approval, worker rollout, provider call count and the two household screens. Record the event ID, execution ID, call ID and plan revision so the rehearsal can be checked.
