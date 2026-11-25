import { authed } from "@/lib/server/route";
import { familyVendors, setItemApproved } from "@/lib/server/vendors";
import { HttpError } from "@/lib/server/weddings";
import { parseApproveItemInput } from "@/lib/vendors";

/** The couple shares (or hides) one item of a booking with the vendor. */
export const POST = authed(async (req, viewer) => {
  const body = await req.json().catch(() => {
    throw new HttpError(400, "bad_json");
  });
  const parsed = parseApproveItemInput(body);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  const weddingId = await setItemApproved(viewer.id, parsed.value);
  return { vendors: await familyVendors(viewer.id, weddingId) };
});
