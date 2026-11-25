import "server-only";

/**
 * Sarvam model APIs, all on the one SARVAM_API_KEY:
 *  - Token Factory (OpenAI-compatible /v2/chat/completions) serving GLM-5.3, for the agent.
 *  - Saaras v4 speech-to-text, for family voice notes.
 */
const BASE = "https://api.sarvam.ai";
const key = () => {
  const k = process.env.SARVAM_API_KEY;
  if (!k) throw new Error("SARVAM_API_KEY missing");
  return k;
};

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
}): Promise<{ message: ChatMessage; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const res = await fetch(`${BASE}/v2/chat/completions`, {
    method: "POST",
    headers: { "api-subscription-key": key(), "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      tools: opts.tools,
      tool_choice: opts.tools ? "auto" : undefined,
      parallel_tool_calls: false,
      reasoning_effort: opts.reasoning ?? "low",
      max_tokens: opts.maxTokens ?? 2000,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(50_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    choices?: { message: ChatMessage }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
    error?: unknown;
  };
  if (!res.ok || !json.choices?.[0]) throw new Error(`sarvam chat ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
  const m = json.choices[0].message;
  return { message: { role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls }, usage: json.usage ?? { prompt_tokens: 0, completion_tokens: 0 } };
}

/** Saaras v4: audio (≤30 s) → text in the speaker's language, plus the detected language. */
export async function transcribe(audio: ArrayBuffer, filename = "voice.ogg"): Promise<{ transcript: string; languageCode: string | null }> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/ogg" }), filename);
  form.append("model", "saaras:v4");
  form.append("mode", "transcribe");
  form.append("keyterms", JSON.stringify(["Sangeet", "Haldi", "Mehendi", "muhurat", "आजी", "आजोबा", "मामा", "VivaahMesh"]));
  const res = await fetch(`${BASE}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": key() },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { transcript?: string; language_code?: string | null };
  if (!res.ok || typeof json.transcript !== "string") throw new Error(`sarvam stt ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return { transcript: json.transcript.trim(), languageCode: json.language_code ?? null };
}
