import "server-only";

const INTERACTION_ID = /^\d{8}\/[\w-]{1,128}$/;

export type TranscriptTurn = { role: "agent" | "user"; text: string };

export async function callTranscript(id: string): Promise<TranscriptTurn[]> {
  const key = process.env.SARVAM_VOICE_API_KEY;
  const scope = [
    process.env.SARVAM_ORG_ID, process.env.SARVAM_WORKSPACE_ID, process.env.SARVAM_APP_ID,
  ];
  if (!key || !scope.every(Boolean) || !INTERACTION_ID.test(id)) throw new Error("invalid_call_transcript_reference");
  const path = scope.map((segment) => encodeURIComponent(segment!)).join("/");
  const response = await fetch(`https://apps.sarvam.ai/api/analytics/v1/${path}/transcripts/${encodeURIComponent(id)}`, {
    headers: { "X-API-Key": key }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("call_transcript_unavailable");
  const result = await response.json();
  if (result.interaction_id !== id || !Array.isArray(result.messages)) throw new Error("invalid_call_transcript");
  return result.messages.flatMap((message: { role?: string; content?: unknown }) => {
    const role = message.role === "assistant" ? "agent" : message.role;
    return (role === "agent" || role === "user") && typeof message.content === "string"
      ? [{ role, text: message.content }] : [];
  });
}
