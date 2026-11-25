import { open } from "@/lib/server/route";
import { guestPage, releaseItem } from "@/lib/server/guests";
import { HttpError } from "@/lib/server/weddings";
import { parseReserveInput } from "@/lib/guests";

/** A guest gives back a gift they reserved, so someone else can take it. */
export const POST = open(async (req) => {
  const body = await req.json().catch(() => {
    throw new HttpError(400, "bad_json");
  });
  const parsed = parseReserveInput(body);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  await releaseItem(parsed.value.code, parsed.value.itemId);
  return { page: await guestPage(parsed.value.code) };
});
