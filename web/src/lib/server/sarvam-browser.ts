import "server-only";

const SAMVAAD_ORIGIN = "https://apps.sarvam.ai";
const INTERACTION_ID = /^\d{8}\/[A-Za-z0-9_-]{1,128}$/;

type SarvamTranscriptTurn = { role: "agent" | "user"; text: string };

export interface SarvamBrowserResult {
  interactionId: string;
  variables: Record<string, unknown>;
  /** Analytics transcript turns retain the language originally spoken. */
  transcript: SarvamTranscriptTurn[];
}

type SarvamVoiceErrorCode = "configuration" | "invalid_request" | "upstream";

export class SarvamVoiceError extends Error {
  readonly code: SarvamVoiceErrorCode;
  readonly upstreamStatus?: number;

  constructor(code: SarvamVoiceErrorCode, upstreamStatus?: number) {
    super(`sarvam_voice_${code}`);
    this.name = "SarvamVoiceError";
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new SarvamVoiceError("configuration");
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonemptyString(value: unknown, maxLength = 256): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function transcriptTurns(input: unknown, textKey: "en_text" | "content"): SarvamTranscriptTurn[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap<SarvamTranscriptTurn>((value) => {
    const turn = asRecord(value);
    const text = turn?.[textKey];
    if (typeof text !== "string" || !text.trim()) return [];
    switch (turn?.role) {
      case "user":
        return [{ role: "user", text }];
      case "agent":
      case "assistant":
        return [{ role: "agent", text }];
      default:
        return [];
    }
  });
}

export function getSarvamBrowserConfig() {
  const version = Number(process.env.SARVAM_APP_VERSION || "1");
  if (!Number.isSafeInteger(version) || version < 1) throw new SarvamVoiceError("configuration");
  return {
    org_id: requiredEnv("SARVAM_ORG_ID"),
    workspace_id: requiredEnv("SARVAM_WORKSPACE_ID"),
    app_id: requiredEnv("SARVAM_APP_ID"),
    version,
  };
}

async function samvaadJson(url: URL, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = requiredEnv("SARVAM_VOICE_API_KEY");
  const headers = new Headers({ "X-API-Key": key, Accept: "application/json" });
  if (body) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SarvamVoiceError("upstream");
  }
  if (!response.ok) throw new SarvamVoiceError("upstream", response.status);
  const data = asRecord(await response.json().catch(() => null));
  if (!data) throw new SarvamVoiceError("upstream");
  return data;
}

function analyticsUrl(config: ReturnType<typeof getSarvamBrowserConfig>, path: string): URL {
  const scope = [config.org_id, config.workspace_id, config.app_id].map(encodeURIComponent).join("/");
  return new URL(`/api/analytics/v1/${scope}/${path}`, SAMVAAD_ORIGIN);
}

/** Use the Analytics API when the original multilingual utterances are needed. */
export async function fetchSarvamTranscript(interactionId: string): Promise<SarvamTranscriptTurn[]> {
  if (!INTERACTION_ID.test(interactionId)) throw new SarvamVoiceError("invalid_request");
  const url = analyticsUrl(getSarvamBrowserConfig(), `transcripts/${encodeURIComponent(interactionId)}`);
  const data = await samvaadJson(url);
  if (data.interaction_id !== interactionId || !Array.isArray(data.messages)) throw new SarvamVoiceError("upstream");
  return transcriptTurns(data.messages, "content");
}

/** Implements the signed-URL request used by sarvam-conv-ai-sdk/browser. */
export async function getSarvamBrowserSession(): Promise<{ url: string; reference_id: string }> {
  const { org_id, workspace_id, app_id, version } = getSarvamBrowserConfig();
  const org = encodeURIComponent(org_id);
  const workspace = encodeURIComponent(workspace_id);
  const app = encodeURIComponent(app_id);
  const url = new URL(`/api/app-runtime/orgs/${org}/workspaces/${workspace}/apps/${app}/url`, SAMVAAD_ORIGIN);
  url.searchParams.set("interaction_type", "call");
  url.searchParams.set("version", String(version));
  const data = await samvaadJson(url);
  const signedUrl = data.url;
  if (typeof signedUrl !== "string" || !URL.canParse(signedUrl) || !nonemptyString(data.reference_id)) {
    throw new SarvamVoiceError("upstream");
  }
  const socketUrl = new URL(signedUrl);
  if (socketUrl.protocol !== "wss:" || socketUrl.username || socketUrl.password) throw new SarvamVoiceError("upstream");
  return { url: signedUrl, reference_id: data.reference_id };
}

/** A client-supplied interaction ID is a lookup hint; only a finished, matching Sarvam record can supply evidence. */
export async function findSarvamBrowserInteraction(input: {
  interactionId: string;
  reference: string;
  startedAt: string;
}): Promise<SarvamBrowserResult | null> {
  const startTime = Date.parse(input.startedAt);
  const now = Date.now();
  if (!INTERACTION_ID.test(input.interactionId) || !nonemptyString(input.reference) || !Number.isFinite(startTime) || startTime > now) {
    throw new SarvamVoiceError("invalid_request");
  }
  const config = getSarvamBrowserConfig();
  const url = analyticsUrl(config, "interactions");
  url.searchParams.set("start_datetime", new Date(startTime - 30_000).toISOString());
  url.searchParams.set("end_datetime", new Date(now + 30_000).toISOString());
  url.searchParams.set("filter_conditions", JSON.stringify([
    { field: "interaction_id", operator: "equals", value: input.interactionId },
    { field: "user_identifier", operator: "equals", value: input.reference },
  ]));
  const data = await samvaadJson(url);
  if (!Array.isArray(data.items)) throw new SarvamVoiceError("upstream");
  const item = data.items.map(asRecord).find((row) =>
    row?.interaction_id === input.interactionId && row.user_identifier === input.reference && row.app_version === config.version,
  );
  if (!item || !nonemptyString(item.start_datetime) || !nonemptyString(item.end_datetime)) return null;
  // Sarvam Analytics timestamps use UTC, including values without an explicit offset.
  const parseTimestamp = (value: string) => Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
  const startedAt = parseTimestamp(item.start_datetime);
  const finishedAt = parseTimestamp(item.end_datetime);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)
    || startedAt < startTime - 30_000 || finishedAt < startedAt || finishedAt > now + 30_000) return null;
  const transcript = await fetchSarvamTranscript(input.interactionId);
  if (transcript.length === 0) return null;
  return { interactionId: input.interactionId, variables: asRecord(item.agent_variables) ?? {}, transcript };
}
