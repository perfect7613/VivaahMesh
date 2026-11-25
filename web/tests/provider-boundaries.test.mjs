import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { boundedRequestBody } from "../src/lib/server/request-body.ts";
import { chat, transcribe, translate } from "../src/lib/server/sarvam.ts";
import { downloadTelegramAudio, MAX_TELEGRAM_AUDIO_BYTES, telegramSpeech, tg } from "../src/lib/server/telegram-bot.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("streamed bodies are rejected without waiting to buffer the complete input", async () => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
      controller.enqueue(new Uint8Array(4));
    },
    cancel() { canceled = true; },
  });
  await assert.rejects(boundedRequestBody(new Response(body), 6), { status: 413 });
  assert.equal(canceled, true);
});

test("Telegram distinguishes document audio and recorded video notes", () => {
  assert.deepEqual(telegramSpeech({
    document: { file_id: "audio-file", file_size: 150, mime_type: "audio/mpeg", file_name: "family.mp3" },
  }), { fileId: "audio-file", fileSize: 150, duration: null, mime: "audio/mpeg", name: "family.mp3" });
  assert.deepEqual(telegramSpeech({
    video_note: { file_id: "video-note", file_size: 200, duration: 25 },
  }), { fileId: "video-note", fileSize: 200, duration: 25, mime: "video/mp4", name: "note.mp4" });
});

test("Telegram bounds both file metadata and downloaded bytes", async () => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:local-test-token");
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: "documents/file_1.mp3", file_size: MAX_TELEGRAM_AUDIO_BYTES + 1 } }))
    .mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: "video_notes/file_2.mp4" } }))
    .mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MAX_TELEGRAM_AUDIO_BYTES + 1)); },
    })))
    .mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: "documents/file_3.mp3", file_size: 3 } }))
    .mockResolvedValueOnce(new Response(Uint8Array.of(1, 2, 3)));
  vi.stubGlobal("fetch", fetch);
  await assert.rejects(downloadTelegramAudio("file-1", MAX_TELEGRAM_AUDIO_BYTES + 1), /^Error: telegram_media_unavailable$/);
  assert.equal(fetch.mock.calls.length, 0);
  await assert.rejects(downloadTelegramAudio("file-1"), /^Error: telegram_media_unavailable$/);
  assert.equal(fetch.mock.calls.length, 1);
  await assert.rejects(downloadTelegramAudio("file-2"), /^Error: telegram_media_unavailable$/);
  assert.deepEqual(new Uint8Array(await downloadTelegramAudio("file-3")), Uint8Array.of(1, 2, 3));
  assert.ok(fetch.mock.calls.every(([, options]) => options.redirect === "error" && options.signal instanceof AbortSignal));
});

test("Telegram and Sarvam errors exclude provider response details or fetch errors", async () => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:local-test-token");
  vi.stubEnv("SARVAM_API_KEY", "local-test-key");
  const fetch = vi.fn()
    .mockRejectedValueOnce(new Error("transport error for credential URL"))
    .mockImplementation(async () => Response.json({ error: "provider echoed a private value" }, { status: 502 }));
  vi.stubGlobal("fetch", fetch);
  await assert.rejects(tg("getMe", {}), /^Error: telegram_request_failed$/);
  await assert.rejects(chat({ model: "test", messages: [] }), /^Error: sarvam_request_failed$/);
  await assert.rejects(transcribe(new ArrayBuffer(1)), /^Error: sarvam_request_failed$/);
  await assert.rejects(translate("test", "hi-IN"), /^Error: sarvam_request_failed$/);
  assert.ok(fetch.mock.calls.every(([, options]) => options.redirect === "error" && options.signal instanceof AbortSignal));
});
