import { open } from "@/lib/server/route";
import { guestPage } from "@/lib/server/guests";
import { HttpError } from "@/lib/server/weddings";

/** A guest's page, reached by their access link. Gated by the wedding's guests stage. */
export const GET = open(async (req) => {
  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code || code.length > 64) throw new HttpError(400, "bad_code");
  return { page: await guestPage(code) };
});
