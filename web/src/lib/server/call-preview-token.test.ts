import { afterEach, expect, it, vi } from "vitest";
import { authorizedPrompt, newCallPreview } from "./call-preview-token";
vi.mock("server-only", () => ({}));
vi.mock("./flags", () => ({ callerPromptFor: async () => ({ variant: "clarify_scope", experiment: { id: 8, key: "candidate" } }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it("binds the shown prompt and call ID to the authorizer, wedding, recipient and expiry", async () => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "disposable-signing-key");
  vi.useFakeTimers();
  const member = { id: "A", wedding_id: "w1" };
  const minted = await newCallPreview(member, "venue");
  expect(await authorizedPrompt(minted.token, member, "venue")).toMatchObject({ id: minted.id, prompt: minted.prompt });
  for (const [actor, scope] of [[{ ...member, id: "B" }, "venue"], [{ ...member, wedding_id: "w2" }, "venue"], [member, "changed"]] as const) {
    await expect(authorizedPrompt(minted.token, actor, scope)).rejects.toMatchObject({ status: 409 });
  }
  vi.advanceTimersByTime(600_000);
  await expect(authorizedPrompt(minted.token, member, "venue")).rejects.toMatchObject({ status: 409 });
});
