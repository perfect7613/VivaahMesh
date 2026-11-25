import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasTelegramWebhookSecret, verifyInitData, viewerFromRequest } from "./telegram-auth";

vi.mock("server-only", () => ({}));

const botToken = "test-bot-token";
const now = 1_800_000_000;
const user = { id: 42, first_name: "Meera" };
const age = 24 * 60 * 60;

function signedAuth(authDate: number, signedUser = user) {
  const params = new URLSearchParams({
    user: JSON.stringify(signedUser),
    query_id: "local-test",
    auth_date: String(authDate),
  });
  params.sort();
  const dataCheckString = [...params].map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Telegram Mini App auth", () => {
  it("accepts a valid launch through the freshness boundary", () => {
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    expect(verifyInitData(signedAuth(now - age), botToken)).toEqual(user);
  });

  it.each([now - age - 1, now + 61, now + 0.5])("rejects an invalid launch timestamp (%s)", (timestamp) => {
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    expect(verifyInitData(signedAuth(timestamp), botToken)).toBeNull();
  });

  it("rejects duplicate fields, malformed hashes and invalid user IDs", () => {
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    const valid = signedAuth(now);
    expect(verifyInitData(`${valid}&user=%7B%7D`, botToken)).toBeNull();
    expect(verifyInitData(`${valid}00`, botToken)).toBeNull();
    expect(verifyInitData(signedAuth(now, { ...user, id: 1.5 }), botToken)).toBeNull();
  });

  it("disables the development identity header in production", () => {
    vi.stubEnv("DEV_AUTH_BYPASS", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(viewerFromRequest(new Request("https://example.test", { headers: { "x-dev-user": "42:Meera" } }))).toBeNull();
  });
});

describe("Telegram webhook secret", () => {
  it("compares byte lengths before timing-safe equality", () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "abc");
    const header = "x-telegram-bot-api-secret-token";
    expect(hasTelegramWebhookSecret(new Request("https://example.test", { headers: { [header]: "abé" } }), header)).toBe(false);
    expect(hasTelegramWebhookSecret(new Request("https://example.test", { headers: { [header]: "abc" } }), header)).toBe(true);
  });
});
