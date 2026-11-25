import "server-only";
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import type { NextRequest, NextResponse } from "next/server";
import { viewerFromRequest, type TelegramUser } from "./telegram-auth";

export const sessionCookie = "vm_browser";
export const nonceCookie = "vm_tg_nonce";
export const emailCookie = "vm_email_pkce";
export const sessionSeconds = 7 * 24 * 60 * 60;
const issuer = "vivaahmesh/browser";
const telegramIssuer = "https://oauth.telegram.org";
const telegramKeys = createRemoteJWKSet(new URL("/.well-known/jwks.json", telegramIssuer));

function sessionKey() {
  const secret = process.env.BROWSER_AUTH_SECRET;
  return secret && secret.length >= 32 ? new TextEncoder().encode(secret) : null;
}

export function appOrigin(req: Request) {
  const configured = process.env.APP_URL;
  if (configured) return new URL(configured).origin;
  return process.env.NODE_ENV !== "production" ? new URL(req.url).origin : null;
}

export function browserCookie(req: NextRequest, res: NextResponse, name: string, value: string, maxAge: number) {
  res.cookies.set(name, value, {
    httpOnly: true,
    secure: appOrigin(req)?.startsWith("https:") ?? true,
    sameSite: name === sessionCookie ? "strict" : "lax",
    path: "/",
    maxAge,
  });
}

export function browserAuthEnabled(req: Request) {
  return !!sessionKey() && !!appOrigin(req);
}

export async function browserSession(viewer: TelegramUser) {
  const key = sessionKey();
  if (!key) throw new Error("browser_auth_unavailable");
  return new SignJWT({ name: viewer.first_name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setSubject(String(viewer.id))
    .setExpirationTime(Math.floor(Date.now() / 1000) + sessionSeconds)
    .sign(key);
}

export async function authenticatedViewer(req: Request): Promise<TelegramUser | null> {
  const telegram = viewerFromRequest(req);
  if (req.headers.has("authorization")) return telegram;
  const origin = req.headers.get("origin");
  if (origin && origin !== appOrigin(req)) return null;
  const key = sessionKey();
  const token = req.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(sessionCookie + "="))?.slice(sessionCookie.length + 1);
  if (key && token) {
    try {
      const { payload } = await jwtVerify(token, key, { issuer, algorithms: ["HS256"], requiredClaims: ["exp", "sub"] });
      const id = Number(payload.sub);
      if (Number.isSafeInteger(id) && id !== 0 && typeof payload.name === "string") {
        return { id, first_name: payload.name };
      }
    } catch {
      return null;
    }
  }
  return telegram;
}

export function telegramClientId() {
  const id = Number(process.env.TELEGRAM_LOGIN_CLIENT_ID ?? process.env.TELEGRAM_BOT_TOKEN?.split(":")[0]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function verifyTelegramLogin(token: string, nonce: string, clientId: number, keys: JWTVerifyGetKey = telegramKeys): Promise<TelegramUser | null> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: telegramIssuer, audience: String(clientId), algorithms: ["RS256"],
      requiredClaims: ["exp", "sub", "iat", "nonce"], maxTokenAge: "5 minutes", clockTolerance: 10,
    });
    const id = payload.id;
    if (payload.nonce !== nonce || typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
    const name = typeof payload.given_name === "string" ? payload.given_name : payload.name;
    return { id, first_name: typeof name === "string" ? name.slice(0, 100) : "Guest" };
  } catch {
    return null;
  }
}
