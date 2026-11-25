import { open } from "@/lib/server/route";
import { vendorPage } from "@/lib/server/vendors";
import { HttpError } from "@/lib/server/weddings";

/** A vendor's run sheet, reached by their access link. Gated by the wedding's day-of stage. */
export const GET = open(async (req) => {
  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code || code.length > 64) throw new HttpError(400, "bad_code");
  return { page: await vendorPage(code) };
});
