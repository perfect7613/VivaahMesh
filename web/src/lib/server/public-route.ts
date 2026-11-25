import "server-only";
import { HttpError } from "./weddings";

/** For token-scoped public pages (guest RSVP, vendor run sheet): the token in the URL is the credential. */
export function publicRoute<C>(fn: (req: Request, ctx: C) => Promise<unknown>) {
  const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" };
  return async (req: Request, ctx: C) => {
    try {
      return Response.json(await fn(req, ctx), { headers });
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status, headers });
      console.error("Public token route failed", e instanceof Error ? e.name : typeof e);
      return Response.json({ error: "server_error" }, { status: 500, headers });
    }
  };
}
