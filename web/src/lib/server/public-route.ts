import "server-only";
import { HttpError } from "./weddings";

/** For token-scoped public pages (guest RSVP, vendor run sheet): the token in the URL is the credential. */
export function publicRoute<C>(fn: (req: Request, ctx: C) => Promise<unknown>) {
  return async (req: Request, ctx: C) => {
    try {
      return Response.json(await fn(req, ctx));
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: "server_error" }, { status: 500 });
    }
  };
}
