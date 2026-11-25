import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { coalesceChanges } from "../src/lib/client/live-refresh.ts";
import { pingWedding, weddingTopic } from "../src/lib/server/wedding-live.ts";
import { isWeddingTopic } from "../src/lib/wedding-topic.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const key = "private-test-signing-secret-for-wedding-realtime";

test("topics are deterministic and opaque, and key rotation changes them", () => {
  vi.stubEnv("WEDDING_REALTIME_SECRET", key);
  const wedding = "5d1d3d4d-e8fb-4e52-b520-4c9a7a992a71";
  const topic = weddingTopic(wedding);
  assert.ok(isWeddingTopic(topic));
  assert.equal(topic, weddingTopic(wedding));
  assert.ok(!topic.includes(wedding));
  assert.ok(!isWeddingTopic(`wedding-${wedding}`));
  assert.notEqual(topic, weddingTopic("other-wedding"));
  vi.stubEnv("WEDDING_REALTIME_SECRET", key + "-rotated");
  assert.notEqual(topic, weddingTopic(wedding));
});

test("broadcast sends a change signal without an identifier, event kind, or record in its payload", async () => {
  vi.stubEnv("WEDDING_REALTIME_SECRET", key);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.vivaahmesh.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
  const fetch = vi.fn().mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", fetch);
  await pingWedding("test-wedding");
  const [[url, options]] = fetch.mock.calls;
  assert.equal(url.href, "https://db.vivaahmesh.test/realtime/v1/api/broadcast");
  assert.equal(options.redirect, "error");
  assert.deepEqual(JSON.parse(options.body), {
    messages: [{ topic: weddingTopic("test-wedding"), event: "changed", payload: {} }],
  });
});

test("a missing topic secret disables broadcasting", async () => {
  vi.stubEnv("WEDDING_REALTIME_SECRET", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "short-test-key");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  assert.equal(weddingTopic("test-wedding"), null);
  await pingWedding("test-wedding");
  assert.equal(fetch.mock.calls.length, 0);
});

test("bursts trigger an immediate refresh and at most one trailing refresh per interval", () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const changes = coalesceChanges(refresh);
  changes.notify();
  for (let i = 0; i < 100; i++) changes.notify();
  assert.equal(refresh.mock.calls.length, 1);
  vi.advanceTimersByTime(999);
  assert.equal(refresh.mock.calls.length, 1);
  vi.advanceTimersByTime(1);
  assert.equal(refresh.mock.calls.length, 2);
  changes.notify();
  changes.cancel();
  vi.advanceTimersByTime(1000);
  assert.equal(refresh.mock.calls.length, 2);
});
