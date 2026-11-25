import "server-only";

import { HttpError } from "./http-error";

export async function boundedRequestBody(req: Pick<Request, "headers" | "body">, limit: number, errorCode = "request_too_large") {
  if (Number(req.headers.get("content-length")) > limit) {
    void req.body?.cancel().catch(() => {});
    throw new HttpError(413, errorCode);
  }
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          void reader.cancel().catch(() => {});
          throw new HttpError(413, errorCode);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function jsonObject(req: Request, limit = 16 * 1024, invalid = "invalid_json") {
  const data = await boundedRequestBody(req, limit);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new HttpError(400, invalid);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, invalid);
  return value as Record<string, unknown>;
}
