import { publishReplay } from "../src/lib/experiment/publish";

publishReplay(process.env.FLAGSMITH_EXPERIMENT_REPLAY_KEY ?? "", process.argv[2] ?? "")
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Could not publish caller metrics");
    process.exitCode = 1;
  });
