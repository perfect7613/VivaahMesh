import "server-only";
import { authenticatedViewer } from "./browser-auth";
import type { TelegramUser } from "./telegram-auth";
import { HttpError } from "./weddings";

/** Wraps a route handler: authenticates the wedding viewer and maps errors to JSON. */
export function authed<C = unknown>(
  fn: (req: Request, viewer: TelegramUser, ctx: C) => Promise<unknown>,
) {
  return async (req: Request, ctx: C) => {
    const headers = { "cache-control": "private, no-store" };
    const viewer = await authenticatedViewer(req);
    if (!viewer) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    try {
      const out = await fn(req, viewer, ctx);
      // A handler may return its own Response (e.g. a 409 that carries the newer plan).
      if (out instanceof Response) {
        const responseHeaders = new Headers(out.headers);
        responseHeaders.set("cache-control", headers["cache-control"]);
        return new Response(out.body, { status: out.status, statusText: out.statusText, headers: responseHeaders });
      }
      return Response.json(out ?? { ok: true }, { headers });
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status, headers });
      // Database error details can contain whole rows, including private family notes.
      const code = e && typeof e === "object" && "code" in e ? e.code : undefined;
      console.error("Authenticated API request failed", typeof code === "string" && /^[A-Z0-9]{5,12}$/.test(code) ? code : "internal");
      return Response.json({ error: "server_error" }, { status: 500, headers });
    }
  };
}
