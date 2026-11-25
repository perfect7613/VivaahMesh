import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  appOrigin, browserAuthEnabled, browserCookie, browserSession, nonceCookie,
  sessionCookie, sessionSeconds, telegramClientId, verifyTelegramLogin,
} from "@/lib/server/browser-auth";
import { jsonObject } from "@/lib/server/request-body";
import { HttpError } from "@/lib/server/http-error";

export function GET(req: NextRequest) {
  const clientId = browserAuthEnabled(req) ? telegramClientId() : null;
  if (!clientId) return NextResponse.json({ clientId: null });
  const nonce = randomBytes(32).toString("base64url");
  const res = NextResponse.json({ clientId, nonce });
  browserCookie(req, res, nonceCookie, nonce, 10 * 60);
  return res;
}

export async function POST(req: NextRequest) {
  if (!browserAuthEnabled(req) || req.headers.get("origin") !== appOrigin(req)) {
    return NextResponse.json({ error: "browser_auth_unavailable" }, { status: 403 });
  }
  try {
    const { token } = await jsonObject(req, 8192);
    const clientId = telegramClientId();
    const nonce = req.cookies.get(nonceCookie)?.value;
    const viewer = clientId && nonce && typeof token === "string"
      ? await verifyTelegramLogin(token, nonce, clientId)
      : null;
    const res = viewer ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "telegram_login_invalid" }, { status: 401 });
    browserCookie(req, res, nonceCookie, "", 0);
    if (viewer) browserCookie(req, res, sessionCookie, await browserSession(viewer), sessionSeconds);
    return res;
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "browser_auth_unavailable" }, { status: 503 });
  }
}

export function DELETE(req: NextRequest) {
  if (req.headers.get("origin") !== appOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  browserCookie(req, res, sessionCookie, "", 0);
  return res;
}
