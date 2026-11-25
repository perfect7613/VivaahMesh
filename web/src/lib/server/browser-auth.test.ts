import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedViewer, browserSession, sessionCookie, verifyTelegramLogin } from "./browser-auth";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllEnvs());

function signedRequest(token: string, headers: Record<string, string> = {}) {
  return new Request("https://wedding.test/api/me", {
    headers: { cookie: `${sessionCookie}=${token}`, ...headers },
  });
}

describe("browser session", () => {
  it("accepts a signed email identity only for the app and preserves Telegram credential precedence", async () => {
    vi.stubEnv("APP_URL", "https://wedding.test");
    vi.stubEnv("BROWSER_AUTH_SECRET", "local-test-secret-for-pwa-authentication");
    const viewer = { id: -5_000_000_000_000_000, first_name: "" };
    const token = await browserSession(viewer);
    await expect(authenticatedViewer(signedRequest(token))).resolves.toEqual(viewer);
    await expect(authenticatedViewer(signedRequest(token, { origin: "https://other.test" }))).resolves.toBeNull();
    await expect(authenticatedViewer(signedRequest(token, { authorization: "tma forged" }))).resolves.toBeNull();
    vi.stubEnv("BROWSER_AUTH_SECRET", "rotated-local-test-secret-for-pwa-authentication");
    await expect(authenticatedViewer(signedRequest(token))).resolves.toBeNull();
  });
});

describe("Telegram browser login", () => {
  it("checks the signature, expiry, audience and current browser nonce, then returns the Telegram ID used by the Mini App", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const key = { ...await exportJWK(publicKey), alg: "RS256" };
    const keys = createLocalJWKSet({ keys: [key] });
    const issue = (aud: number, expiry: string) => new SignJWT({ id: 42, given_name: "Meera", nonce: "caller-nonce" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://oauth.telegram.org")
      .setSubject("provider-subject")
      .setAudience(String(aud))
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(privateKey);
    const verify = (token: string, nonce = "caller-nonce") => verifyTelegramLogin(token, nonce, 123, keys);
    const valid = await issue(123, "5 minutes");
    await expect(verify(valid)).resolves.toEqual({ id: 42, first_name: "Meera" });
    await expect(verify(valid, "different-browser")).resolves.toBeNull();
    await expect(verify(await issue(456, "5 minutes"))).resolves.toBeNull();
    await expect(verify(await issue(123, "-1 minute"))).resolves.toBeNull();
    await expect(verify(valid.slice(0, -4) + "abcd")).resolves.toBeNull();
  });
});
