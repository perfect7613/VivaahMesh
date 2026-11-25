import "server-only";
import { viewerFromRequest, type TelegramUser } from "./telegram-auth";
import { HttpError } from "./weddings";

/** Wraps a route handler: authenticates the Telegram viewer and maps errors to JSON. */
export function authed<C = unknown>(
  fn: (req: Request, viewer: TelegramUser, ctx: C) => Promise<unknown>,
) {
  return async (req: Request, ctx: C) => {
    const viewer = viewerFromRequest(req);
    if (!viewer) return Response.json({ error: "unauthorized" }, { status: 401 });
    try {
      const out = await fn(req, viewer, ctx);
      return Response.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: "server_error" }, { status: 500 });
    }
  };
}
