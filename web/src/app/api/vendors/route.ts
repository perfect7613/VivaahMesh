import { authed } from "@/lib/server/route";
import { addVendor, familyVendors } from "@/lib/server/vendors";
import { HttpError } from "@/lib/server/weddings";
import { parseVendorInput } from "@/lib/vendors";

/** The family's view of vendors. Prices and the budget are included for the couple only. */
export const GET = authed(async (req, viewer) => {
  const weddingId = new URL(req.url).searchParams.get("wedding") ?? undefined;
  return { vendors: await familyVendors(viewer.id, weddingId) };
});

/** The couple adds a vendor (including the family's own); the response carries their link code. */
export const POST = authed(async (req, viewer) => {
  const body = await req.json().catch(() => {
    throw new HttpError(400, "bad_json");
  });
  const parsed = parseVendorInput(body);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  const added = await addVendor(viewer.id, parsed.value);
  return { vendorId: added.vendorId, vendors: await familyVendors(viewer.id, added.weddingId) };
});
