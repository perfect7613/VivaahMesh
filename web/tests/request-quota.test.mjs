import assert from "node:assert/strict";
import { test, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/server/supabase", () => ({ db: () => ({ rpc }) }));

import { takeAgentRequest } from "../src/lib/server/request-quota.ts";

test("interactive requests share a daily quota keyed on the Telegram user", async () => {
  rpc.mockReset().mockResolvedValue({ data: true, error: null });
  assert.equal(await takeAgentRequest(123456789), true);
  assert.deepEqual(rpc.mock.calls, [["take_voice_request", {
    p_scope: "tg:123456789",
    p_operation: "planning-agent",
    p_limit: 20,
    p_window_seconds: 86400,
  }]]);
});

test("quota denials and database failures both block the request", async () => {
  rpc.mockReset()
    .mockResolvedValueOnce({ data: false, error: null })
    .mockResolvedValueOnce({ data: null, error: {} });
  assert.equal(await takeAgentRequest(123456789), false);
  await assert.rejects(takeAgentRequest(123456789), /request_quota_unavailable/);
});
