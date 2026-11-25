import "server-only";
import crypto from "node:crypto";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Validates Telegram Mini App initData as described in
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Returns the user only if the hash matches and the data is fresh.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 24 * 60 * 60,
): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return null;
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get("auth_date"));
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || age < -60 || age > maxAgeSeconds) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "null") as TelegramUser | null;
    return user && Number.isSafeInteger(user.id) && user.id > 0 && typeof user.first_name === "string" ? user : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the caller of an API route. Mini App requests send
 * `Authorization: tma <initData>`. Local development (never production) can
 * send `x-dev-user: <id>:<name>` when DEV_AUTH_BYPASS=1.
 */
export function viewerFromRequest(req: Request): TelegramUser | null {
  const auth = req.headers.get("authorization") ?? "";
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (auth.startsWith("tma ") && token) {
    return verifyInitData(auth.slice(4), token);
  }
  const dev = req.headers.get("x-dev-user");
  if (dev && process.env.DEV_AUTH_BYPASS === "1" && process.env.NODE_ENV !== "production") {
    const [id, ...name] = dev.split(":");
    const n = Number(id);
    if (Number.isSafeInteger(n) && n > 0) return { id: n, first_name: name.join(":") || "Dev" };
  }
  return null;
}

/** Verifies the shared secret on incoming requests from Telegram and setup operators. */
export function hasTelegramWebhookSecret(req: Request, header: string): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return false;
  const actual = Buffer.from(req.headers.get(header) ?? "");
  const expected = Buffer.from(secret);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
