import crypto from "node:crypto";
import { appUrl, tg } from "@/lib/server/telegram-bot";

/**
 * One-time bot setup after each deploy:
 *   curl -X POST "$APP_URL/api/telegram/setup" -H "x-setup-secret: $TELEGRAM_WEBHOOK_SECRET"
 * Registers the webhook, commands, menu button and description.
 */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const got = req.headers.get("x-setup-secret") ?? "";
  if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new Response("forbidden", { status: 403 });
  }
  if (!process.env.APP_URL?.startsWith("https://")) {
    return Response.json({ error: "APP_URL must be an https URL" }, { status: 400 });
  }

  const results = await Promise.allSettled([
    tg("setWebhook", {
      url: appUrl("/api/telegram/webhook"),
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
    tg("setMyCommands", { commands: [{ command: "start", description: "Open your wedding" }] }),
    tg("setMyCommands", { commands: [{ command: "start", description: "अपनी शादी खोलें" }], language_code: "hi" }),
    tg("setMyCommands", { commands: [{ command: "start", description: "तुमचं लग्न उघडा" }], language_code: "mr" }),
    tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Our Wedding", web_app: { url: appUrl("/tg") } } }),
    tg("setMyDescription", {
      description:
        "Vivaah keeps both families on one wedding plan, each in their own language. Set up your wedding in a minute, invite the other family, and send me any wish, note or voice note.",
    }),
    tg("setMyShortDescription", { short_description: "One wedding plan for two families 🌼" }),
  ]);
  return Response.json(results.map((r) => (r.status === "fulfilled" ? "ok" : String(r.reason))));
}
