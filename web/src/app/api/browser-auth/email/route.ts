import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  appOrigin, browserAuthEnabled, browserCookie, browserSession, emailCookie, sessionCookie, sessionSeconds,
} from "@/lib/server/browser-auth";
import { HttpError } from "@/lib/server/http-error";
import { jsonObject } from "@/lib/server/request-body";
import { db } from "@/lib/server/supabase";

function authClient(storage: Record<string, string>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("email_login_unavailable");
  return createClient(url, key, {
    auth: {
      flowType: "pkce",
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (key) => Object.hasOwn(storage, key) ? storage[key] : null,
        setItem: (key, value) => { storage[key] = value; },
        removeItem: (key) => { delete storage[key]; },
      },
    },
  }).auth;
}

function joinCode(value: unknown): string {
  return typeof value === "string" && /^(?:[0-9a-f]{10}|[0-9a-f]{32})$/.test(value) ? value : "";
}

export async function POST(req: NextRequest) {
  const origin = appOrigin(req);
  if (!origin || !browserAuthEnabled(req) || req.headers.get("origin") !== origin) {
    return NextResponse.json({ error: "email_login_unavailable" }, { status: 403 });
  }
  try {
    const { email, join } = await jsonObject(req, 2048);
    if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    const storage: Record<string, string> = Object.create(null);
    const { error } = await authClient(storage).signInWithOtp({
      email,
      options: { emailRedirectTo: new URL("/api/browser-auth/email", origin).href },
    });
    if (error) return NextResponse.json({ error: "email_login_unavailable" }, { status: error.status === 429 ? 429 : 503 });
    const res = NextResponse.json({ ok: true });
    const pending = Buffer.from(JSON.stringify({ storage, join: joinCode(join) })).toString("base64url");
    browserCookie(req, res, emailCookie, pending, 60 * 60);
    return res;
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "email_login_unavailable" }, { status: 503 });
  }
}

export async function GET(req: NextRequest) {
  const origin = appOrigin(req);
  if (!origin || !browserAuthEnabled(req)) {
    return NextResponse.json({ error: "email_login_unavailable" }, { status: 503 });
  }

  const next = new URL("/tg", origin);
  let token: string | undefined;
  try {
    const code = req.nextUrl.searchParams.get("code");
    const pending = req.cookies.get(emailCookie)?.value;
    if (!pending || !code) throw new Error("email_login_invalid");
    const { storage, join } = JSON.parse(Buffer.from(pending, "base64url").toString("utf8")) as {
      storage: Record<string, string>;
      join: string;
    };
    const validJoin = joinCode(join);
    if (validJoin) next.searchParams.set("join", validJoin);
    const { data, error } = await authClient(storage).exchangeCodeForSession(code);
    const user = data.user;
    if (error || !user?.email_confirmed_at) throw new Error("email_login_invalid");
    const result = await db().rpc("standalone_viewer_id", { p_auth_user_id: user.id });
    const id = Number(result.data);
    if (result.error || !Number.isSafeInteger(id) || id > -5_000_000_000_000_000) throw new Error("email_viewer_unavailable");
    token = await browserSession({ id, first_name: "" });
  } catch {
    next.searchParams.set("login", "email_error");
  }
  const res = NextResponse.redirect(next, 303);
  browserCookie(req, res, emailCookie, "", 0);
  if (token) browserCookie(req, res, sessionCookie, token, sessionSeconds);
  return res;
}
