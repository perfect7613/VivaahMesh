import "server-only";

const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
  return json.result;
}

export function appUrl(path = "/tg"): string {
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

export function botLink(startPayload: string): string {
  return `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${startPayload}`;
}

/** One message, one clear button that opens the Mini App. */
export function sendWithApp(chatId: number, text: string, buttonText: string, path: string) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: buttonText, web_app: { url: appUrl(path) } }]] },
  });
}

export function send(chatId: number, text: string) {
  return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
