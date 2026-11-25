import { open } from "@/lib/server/route";
import { guestPage, saveRsvp } from "@/lib/server/guests";
import { HttpError } from "@/lib/server/weddings";
import { parseRsvpInput } from "@/lib/guests";

/** One guest's RSVP for one function. Only that function's counts change. */
export const POST = open(async (req) => {
  const body = await req.json().catch(() => {
    throw new HttpError(400, "bad_json");
  });
  const parsed = parseRsvpInput(body);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  await saveRsvp(parsed.value);
  return { page: await guestPage(parsed.value.code) };
});
