import { authed } from "@/lib/server/route";
import { addBooking, familyVendors } from "@/lib/server/vendors";
import { HttpError } from "@/lib/server/weddings";
import { parseBookingInput } from "@/lib/vendors";

/** The couple records one booking, which may cover several functions but is counted once. */
export const POST = authed(async (req, viewer) => {
  const body = await req.json().catch(() => {
    throw new HttpError(400, "bad_json");
  });
  const parsed = parseBookingInput(body);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  const out = await addBooking(viewer.id, parsed.value);
  return { bookingId: out.bookingId, vendors: await familyVendors(viewer.id, out.weddingId) };
});
