import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { processCallResult } from "../src/lib/server/calls";
import { killSwitch } from "../src/lib/server/flags";
import { db } from "../src/lib/server/supabase";

// A stopped Deployment leaves the ingested result in Postgres. Normal ticks and approved
// HTTP replays share the same atomic apply_call_evidence transaction.
async function main() {
  if (process.env.CALL_RESULT_PROCESSOR !== "worker" || !process.env.FLAGSMITH_SERVER_KEY) {
    throw new Error("Worker mode and FLAGSMITH_SERVER_KEY are required");
  }
  const client = db();
  let stopping = false;
  let ready = false;
  const health = createServer((_req, res) => {
    res.writeHead(ready && !stopping ? 200 : 503).end();
  }).listen(8080);
  const stop = () => { stopping = true; };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    while (!stopping) {
      let worked = false;
      try {
        if (await killSwitch("result_processing_paused", true)) {
          const { error } = await client.from("calls").select("id").limit(0);
          if (error) throw error;
        } else {
          const { data: callId, error } = await client.rpc("claim_next_call_result");
          if (error) throw error;
          if (typeof callId === "string") {
            await processCallResult(callId);
            worked = true;
          }
        }
        ready = true;
      } catch {
        ready = false;
        console.error("Result worker tick failed. The stored result remains eligible for retry.");
      }
      if (!worked && !stopping) await sleep(5000);
    }
  } finally {
    health.close();
  }
}

main().catch(() => { console.error("Result worker startup failed. Check its server configuration."); process.exitCode = 1; });
