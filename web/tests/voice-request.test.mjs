import assert from "node:assert/strict";
import { test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/server/weddings", () => ({
  HttpError: class extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  },
}));

import { voiceClipForm, voiceJsonObject } from "../src/lib/server/voice-request.ts";

function streamedRequest(...parts) {
  const bytes = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(bytes.encode(part));
      controller.close();
    },
  });
  return new Request("https://example.test", { method: "POST", body, duplex: "half" });
}

test("a JSON route accepts an object split across chunks and bounds bytes without Content-Length", async () => {
  const body = await voiceJsonObject(streamedRequest('{"answer":', '"हो"}'));
  assert.deepEqual(body, { answer: "हो" });
  await assert.rejects(voiceJsonObject(streamedRequest('{"answer":', '"हो"}'), 14), { status: 413 });
});

test("a supported audio upload preserves its language and wedding scope", async () => {
  const form = new FormData();
  const header = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
  form.set("audio", new File([header], "voice-note.webm", { type: "audio/webm" }));
  form.set("language", "mr");
  form.set("weddingId", "fixture-wedding");
  const result = await voiceClipForm(new Request("https://example.test", { method: "POST", body: form }));
  assert.equal(result.language, "mr");
  assert.equal(result.weddingId, "fixture-wedding");
  assert.equal(result.audio.name, "voice-note.webm");
});

test("the upload parser bounds a request with an accurate known Content-Length", async () => {
  let read = false;
  const body = new ReadableStream({ pull() { read = true; } }, { highWaterMark: 0 });
  const req = new Request("https://example.test", {
    method: "POST",
    body,
    duplex: "half",
    headers: { "Content-Type": "multipart/form-data; boundary=fixture", "Content-Length": "4194304" },
  });
  await assert.rejects(voiceClipForm(req), { status: 413, message: "audio_too_large" });
  assert.equal(read, false);
});
