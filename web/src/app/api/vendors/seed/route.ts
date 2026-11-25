import { authed } from "@/lib/server/route";
import { familyVendors, seedDemoVendors } from "@/lib/server/vendors";
import { HttpError } from "@/lib/server/weddings";

/** Couple-only: load labelled sample vendors. */
export const POST = authed(async (req, viewer) => {
  const body = (await req.json().catch(() => ({}))) as { weddingId?: unknown };
  if (body.weddingId !== undefined && typeof body.weddingId !== "string") throw new HttpError(400, "bad_wedding");
  const weddingId = await seedDemoVendors(viewer.id, body.weddingId as string | undefined);
  return { vendors: await familyVendors(viewer.id, weddingId) };
});
