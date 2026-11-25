import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authorizeCall, callPreview, rehearsalCall } from "./calls";
import { browserInvite, consentView } from "./browser-calls";

const { lookup, insert, flagsForMember, killSwitch, takeVoiceRequest, browserConfig, logEvent } = vi.hoisted(() => ({
  lookup: vi.fn(), insert: vi.fn(), flagsForMember: vi.fn(), killSwitch: vi.fn(), takeVoiceRequest: vi.fn(),
  browserConfig: vi.fn(), logEvent: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n", () => import("../i18n"));
vi.mock("@/lib/venue-evidence", () => import("../venue-evidence"));
vi.mock("./translate", () => ({ localized: vi.fn() }));
vi.mock("./supabase", () => ({ db: () => ({ from: lookup }) }));
vi.mock("./flags", () => ({ flagsForMember, killSwitch, callerPromptFor: async () => ({ variant: "baseline", version: "v1" }), recordVendorMetrics: vi.fn() }));
vi.mock("./weddings", async (original) => ({
  ...await original<typeof import("./weddings")>(), logEvent,
  memberships: async () => [{ id: "member-1", wedding_id: "wedding-1", is_couple: true }],
}));
vi.mock("./voice-request", () => ({ takeVoiceRequest }));
vi.mock("./sarvam-browser", () => ({ getSarvamBrowserConfig: browserConfig }));
vi.mock("./agent", () => ({ runAgent: vi.fn() }));

const seeded = { is_seeded_demo: true, partner_a: "Meera", partner_b: "Aarav" };
const query = (row: unknown) => {
  const builder = {
    select: () => builder, eq: () => builder, is: () => builder, order: () => builder, limit: () => builder,
    single: async () => ({ data: row, error: null }),
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return builder;
};

beforeEach(() => {
  vi.resetAllMocks();
  for (const name of ["SARVAM_VOICE_API_KEY", "SARVAM_ORG_ID", "SARVAM_WORKSPACE_ID",
    "SARVAM_APP_ID", "SARVAM_CONNECTION_ID", "SARVAM_AGENT_PHONE"]) {
    vi.stubEnv(name, "fixture");
  }
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-preview-signing-key");
  vi.stubEnv("DEMO_VENUE_PHONE", "+15550100101");
  vi.stubEnv("DEMO_VENUE_NAME", "Configured Contact");
  vi.stubEnv("DEMO_REHEARSAL_CALLS", "0");
  vi.stubEnv("DEMO_SEEDED_LIVE_CALLS", "0");
  lookup.mockImplementation((table) => table === "weddings" ? query(seeded) : {
    ...query(null), insert, update: () => query(null),
  });
  insert.mockImplementation((row) => query({ ...row, id: "call-1" }));
  flagsForMember.mockResolvedValue({
    features: { voice_channel: { enabled: true, value: "browser" }, caller_prompt: { value: "baseline" } },
    policy: { version: "fixture" },
  });
  killSwitch.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("previews and simulates a seeded fixture when the production phone and browser are configured", async () => {
  const fetch = vi.fn(() => { throw new Error("Unexpected upstream request"); });
  vi.stubGlobal("fetch", fetch);
  expect(await callPreview(1)).toMatchObject({
    browserEnabled: false, rehearsal: true, configured: true,
    recipient: { name: "Marigold Hall (rehearsal)", phone: "no phone call" },
  });
  const call = await authorizeCall(1);
  expect(call).toMatchObject({ rehearsal: true, status: "dialing", recipient_phone: "rehearsal" });
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ flags: expect.objectContaining({ channel: "rehearsal", seeded_rehearsal: true }) }));
  expect(takeVoiceRequest).toHaveBeenCalledExactlyOnceWith("wedding-1", "phone-call");
  expect(fetch).not.toHaveBeenCalled();
});

it("blocks rehearsal when the outbound kill switch is off", async () => {
  killSwitch.mockResolvedValue(false);
  expect(await callPreview(1)).toMatchObject({ dialingEnabled: false, rehearsal: true });
  expect(await authorizeCall(1)).toMatchObject({ status: "blocked", error: "outbound_dialing_disabled" });
  expect(takeVoiceRequest).not.toHaveBeenCalled();
});

it("blocks browser invites and previously issued consent tokens until explicit opt-in", async () => {
  lookup.mockImplementation((table) => query(table === "weddings" ? seeded : {
    wedding_id: "wedding-1", browser_consent_expires_at: "2099-01-01T00:00:00Z",
  }));
  await expect(browserInvite(1, { authorize: true, weddingId: "wedding-1" })).rejects.toThrow("browser_mode_disabled");
  await expect(consentView("x".repeat(43))).rejects.toThrow("browser_mode_disabled");
  expect(browserConfig).not.toHaveBeenCalled();
  vi.stubEnv("DEMO_SEEDED_LIVE_CALLS", "1");
  expect(await callPreview(1)).toMatchObject({ browserEnabled: true, rehearsal: false, browserRecipient: "Configured Contact" });
  expect(await consentView("x".repeat(43))).toMatchObject({ status: "awaiting_consent" });
  expect(rehearsalCall(seeded)).toBe(false);
});

it("allows a deliberate live phone call only after seeded opt-in and the normal authorization", async () => {
  vi.stubEnv("DEMO_SEEDED_LIVE_CALLS", "1");
  vi.stubEnv("CALLS_WEBHOOK_SECRET", "fixture-webhook-secret");
  flagsForMember.mockResolvedValue({
    features: { voice_channel: { enabled: true, value: "phone" }, caller_prompt: { value: "baseline" } },
    policy: { version: "fixture" },
  });
  const fetch = vi.fn(async () => Response.json({ attempt_id: "fixture-attempt" }));
  vi.stubGlobal("fetch", fetch);
  expect(await callPreview(1)).toMatchObject({
    rehearsal: false, browserEnabled: false, recipient: { name: "Configured Contact", phone: "+•••••••0101" },
  });
  expect(await authorizeCall(1)).toMatchObject({ status: "dialing", recipient_phone: "+15550100101" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(takeVoiceRequest).toHaveBeenCalledWith(expect.any(String), "phone-destination");
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ flags: expect.objectContaining({ channel: "phone" }) }));
});

it("preserves ordinary wedding mode and the legacy no-provider rehearsal setting", () => {
  expect(rehearsalCall({ is_seeded_demo: false })).toBe(false);
  vi.stubEnv("SARVAM_VOICE_API_KEY", "");
  expect(rehearsalCall({ is_seeded_demo: false })).toBe(false);
  vi.stubEnv("DEMO_REHEARSAL_CALLS", "1");
  expect(rehearsalCall({ is_seeded_demo: false })).toBe(true);
});

it("requires a fresh authorization if a seeded phone preview switches from simulated to live", async () => {
  flagsForMember.mockResolvedValue({ features: { voice_channel: { enabled: true, value: "phone" } }, policy: { version: "v1" } });
  const preview = await callPreview(1);
  vi.stubEnv("DEMO_SEEDED_LIVE_CALLS", "1");
  await expect(authorizeCall(1, undefined, false, preview.previewToken)).rejects.toMatchObject({ status: 409 });
  expect(insert).not.toHaveBeenCalled();
  expect(takeVoiceRequest).not.toHaveBeenCalled();
});
