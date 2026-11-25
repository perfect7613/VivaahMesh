import "server-only";

import { boundedRequestBody } from "./request-body";

/**
 * Sarvam model APIs, all on the one SARVAM_API_KEY:
 *  - Token Factory (OpenAI-compatible /v2/chat/completions) serving GLM-5.3, for the agent.
 *  - Saaras v4 speech-to-text, for family voice notes.
 */
const BASE = "https://api.sarvam.ai";
async function sarvamJson<T>(path: string, body: BodyInit, timeout: number): Promise<T> {
  try {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) throw new Error("sarvam_unconfigured");
    const headers: Record<string, string> = { "api-subscription-key": apiKey };
    if (typeof body === "string") headers["content-type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new Error("sarvam_http_error");
    const bytes = await boundedRequestBody(res, 512 * 1024);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  } catch {
    throw new Error("sarvam_request_failed");
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export async function chat(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  reasoning?: "low" | "high" | "max";
  maxTokens?: number;
  json?: boolean;
}): Promise<{ message: ChatMessage; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const json = await sarvamJson<{
    choices?: { message: ChatMessage }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  } | null>("/v2/chat/completions", JSON.stringify({
    model: opts.model,
    messages: opts.messages,
    tools: opts.tools,
    tool_choice: opts.tools ? "auto" : undefined,
    parallel_tool_calls: false,
    reasoning_effort: opts.reasoning ?? "low",
    max_tokens: opts.maxTokens ?? 2000,
    temperature: 0.2,
    response_format: opts.json ? { type: "json_object" } : undefined,
  }), 55_000);
  const m = Array.isArray(json?.choices) ? json.choices[0]?.message : undefined;
  if (!m || typeof m !== "object" || (m.content !== null && m.content !== undefined && typeof m.content !== "string") ||
      (m.tool_calls && !Array.isArray(m.tool_calls))) throw new Error("sarvam_invalid_chat_response");
  return { message: { role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls }, usage: json?.usage ?? { prompt_tokens: 0, completion_tokens: 0 } };
}

/** Saaras v4: audio (≤30 s) → text in the speaker's language, plus the detected language. */
export async function transcribe(audio: ArrayBuffer, filename = "voice.ogg", mime = "audio/ogg"): Promise<{ transcript: string; languageCode: string | null }> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mime }), filename);
  form.append("model", "saaras:v4");
  form.append("mode", "transcribe");
  form.append("keyterms", JSON.stringify(["Sangeet", "Haldi", "Mehendi", "muhurat", "आजी", "आजोबा", "मामा", "VivaahMesh"]));
  const json = await sarvamJson<{ transcript?: string; language_code?: string | null } | null>("/speech-to-text", form, 30_000);
  if (typeof json?.transcript !== "string") throw new Error("sarvam_invalid_transcription");
  return { transcript: json.transcript.trim(), languageCode: typeof json.language_code === "string" ? json.language_code : null };
}

/** Sarvam Translate (sarvam-translate:v1, all 22 scheduled languages). English → target. */
export async function translate(text: string, target: string): Promise<string> {
  const json = await sarvamJson<{ translated_text?: string } | null>("/translate", JSON.stringify({
    input: text.slice(0, 2000), source_language_code: "en-IN", target_language_code: target, model: "sarvam-translate:v1",
  }), 20_000);
  if (typeof json?.translated_text !== "string" || !json.translated_text) throw new Error("sarvam_invalid_translation");
  return json.translated_text;
}
