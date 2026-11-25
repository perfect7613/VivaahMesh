import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { groupPattern, normalizeMessage, validSignature } from "./protocol.mjs";

const run = promisify(execFile);
const log = (status) => console.error(`[whatsapp] ${status}`);
const childEnvironment = Object.fromEntries(
  ["HOME", "PATH", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"].flatMap(
    (name) => process.env[name] ? [[name, process.env[name]]] : [],
  ),
);

async function readPayload(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) throw new Error("oversize webhook");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function main() {
  const args = process.argv.slice(2);
  const readOnly = args.includes("--read-only");
  const { WHATSAPP_GROUP: group, WHATSAPP_LANGUAGE: language = "en", WACLI_STORE_DIR: store,
    BRIDGE_APP_URL: appUrl, BRIDGE_SECRET: secret } = process.env;
  if (args.some((arg) => arg !== "--read-only") || !store || !groupPattern.test(group ?? "") ||
      !["en", "hi", "mr"].includes(language)) {
    throw new Error("Set WACLI_STORE_DIR, WHATSAPP_GROUP and a supported WHATSAPP_LANGUAGE.");
  }
  const endpoint = readOnly ? null : new URL("/api/bridge/whatsapp", appUrl);
  if (endpoint && (endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
      !secret || secret.length < 32 || secret.length > 256)) {
    throw new Error("Set an HTTPS BRIDGE_APP_URL and a BRIDGE_SECRET of 32–256 characters.");
  }
  const localSecret = randomBytes(32).toString("hex");
  const command = ["--store", store];
  let stopped = false;

  async function app(payload, retry = true) {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(50_000),
          headers: { "content-type": "application/json", "x-bridge-secret": secret },
          body: JSON.stringify(payload),
        });
        if (response.ok) return await response.json();
        await response.body?.cancel();
        if (response.status < 500 && response.status !== 429) {
          log(`app_rejected_${response.status}`);
          return { status: "error" };
        }
      } catch {
        // Both ingest retries and polling may time out while the server finishes.
      }
      if (!retry || attempt >= 2 || stopped) throw new Error("app_unavailable");
      await delay(500 * 2 ** attempt);
    }
  }

  async function handle(message) {
    if (message.action !== "voice") {
      const result = await app(message);
      if (message.action === "link" && result.status === "linked") log("group_linked");
      return;
    }
    const ready = await app({ ...message, action: "voice_check" });
    if (ready.status !== "ready") return;

    const temp = await mkdtemp(join(tmpdir(), "vivaahmesh-voice-"));
    try {
      const audio = join(temp, "voice.ogg");
      await run("wacli", [...command, "--timeout", "20s", "--read-only", "media", "download",
        "--chat", group, "--id", message.messageId, "--output", audio],
      { env: childEnvironment, timeout: 25_000 });
      const info = await stat(audio);
      if (!info.isFile() || info.size > 1_048_576) throw new Error("invalid_audio");
      const { stdout } = await run("ffprobe", ["-v", "error", "-protocol_whitelist", "file",
        "-f", "ogg", "-show_entries", "format=duration:stream=codec_name,codec_type", "-of", "json", audio],
      { env: childEnvironment, timeout: 5000, maxBuffer: 8192 });
      const probe = JSON.parse(stdout);
      const duration = Number(probe.format?.duration);
      if (probe.streams?.length !== 1 || probe.streams[0].codec_name !== "opus" ||
          probe.streams[0].codec_type !== "audio" || !(duration > 0 && duration <= 30)) {
        throw new Error("unsupported_audio");
      }
      await app({ ...message, audio: (await readFile(audio)).toString("base64") }, false);
    } finally {
      await rm(temp, { force: true, recursive: true });
    }
  }

  let pending = 0;
  let queue = Promise.resolve();
  const server = createServer({ requestTimeout: 5000 }, async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/events") {
        response.writeHead(404).end();
        return;
      }
      const bytes = await readPayload(request);
      if (!validSignature(localSecret, bytes, request.headers["x-wacli-signature"])) {
        response.writeHead(401).end();
        return;
      }
      const message = normalizeMessage(JSON.parse(bytes), group, language);
      if (message && readOnly) log(`preview_${message.action}`);
      if (message && !readOnly && !stopped) {
        if (pending >= 64) {
          log("ingress_queue_full");
          response.writeHead(503).end();
          return;
        }
        pending++;
        queue = queue.then(async () => {
          try {
            if (!stopped) await handle(message);
          } catch {
            log(`ingress_${message.action}_failed`);
          } finally {
            pending--;
          }
        });
      }
      response.writeHead(204).end();
    } catch {
      if (!response.destroyed) response.writeHead(400).end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const child = spawn("wacli", [...command, "sync", "--follow", "--events", "--max-reconnect", "0",
    "--max-db-size", "500MB", "--presence-mode", "quiet", "--webhook-allow-private",
    "--webhook-events", "message", "--webhook", `http://127.0.0.1:${server.address().port}/events`,
    "--webhook-secret", localSecret], { env: childEnvironment, stdio: ["ignore", "ignore", "pipe"] });

  let pollTimer;
  let online = false;
  let polling = false;
  async function poll() {
    if (stopped || readOnly || !online || polling || pending > 0) return;
    polling = true;
    try {
      const result = await app({ action: "poll", group }, false);
      if (result.status === "notice" && typeof result.message === "string" && !stopped) {
        await run("wacli", [...command, "--timeout", "25s", "send", "text", "--to", group,
          "--message", result.message, "--no-preview"], { env: childEnvironment, timeout: 30_000 });
      }
    } catch {
      log("notice_poll_or_send_failed");
    } finally {
      polling = false;
    }
  }

  const events = createInterface({ input: child.stderr });
  events.on("line", (line) => {
    try {
      const { event, code } = JSON.parse(line);
      if (event === "connected") online = true;
      if (["disconnected", "logged_out"].includes(event)) online = false;
      if (event === "logged_out") log("linked_device_revoked");
      if (event === "warning" && code === "sync_webhook_failed") log("wacli_webhook_delivery_failed");
    } catch {
      // wacli stderr can include local paths or identifiers.
    }
  });

  function stop(status = 0) {
    if (stopped) return;
    stopped = true;
    process.exitCode = status;
    clearInterval(pollTimer);
    server.close();
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }

  child.on("error", () => {
    log("wacli_start_failed");
    stop(1);
  });
  child.on("close", () => {
    if (!stopped) log("wacli_sync_exited");
    stop(1);
  });
  process.on("SIGTERM", () => stop());
  process.on("SIGINT", () => stop());
  if (!readOnly) pollTimer = setInterval(() => void poll(), 15_000);
  log(readOnly ? "preview_started" : "bridge_started");
}

main().catch(() => {
  log("startup_failed_check_readme_settings");
  process.exitCode = 1;
});
