import { open } from "@/lib/server/route";
import { guestPage, reserveItem } from "@/lib/server/guests";
import { HttpError } from "@/lib/server/weddings";
import { parseReserveInput } from "@/lib/guests";

/** Reserve one gift. 409 {error: "sold_out"} if the last one was just taken by someone else. */
export const POST = open(async (req) => {
  const body = await req.json().catch(() => {
    throw new HttpError(400, "bad_json");
  });
  const parsed = parseReserveInput(body);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  const outcome = await reserveItem(parsed.value.code, parsed.value.itemId);
  const page = await guestPage(parsed.value.code);
  return outcome === "sold_out" ? Response.json({ error: "sold_out", page }, { status: 409 }) : { outcome, page };
});
