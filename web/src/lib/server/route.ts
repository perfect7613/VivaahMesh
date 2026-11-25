import "server-only";
import { unstable_rethrow } from "next/navigation";
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
      // A handler may return its own Response (e.g. a 409 that carries the newer plan).
      if (out instanceof Response) return out;
      return Response.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: "server_error" }, { status: 500 });
    }
  };
}

/**
 * Wraps a route that is reached by an unguessable link instead of a login (a guest's access code).
 * Same error mapping as `authed`; the handler is responsible for checking the code.
 */
export function open<C = unknown>(fn: (req: Request, ctx: C) => Promise<unknown>) {
  return async (req: Request, ctx: C) => {
    try {
      const out = await fn(req, ctx);
      if (out instanceof Response) return out;
      return Response.json(out ?? { ok: true });
    } catch (e) {
      // Next's own control flow (e.g. "this route reads the request, so it is dynamic") is not an error.
      unstable_rethrow(e);
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: "server_error" }, { status: 500 });
    }
  };
}
