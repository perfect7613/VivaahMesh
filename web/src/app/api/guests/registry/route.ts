import { authed } from "@/lib/server/route";
import { addRegistryItem, familyGuestSummary } from "@/lib/server/guests";
import { HttpError } from "@/lib/server/weddings";

/** The couple adds a (voluntary) registry item. */
export const POST = authed(async (req, viewer) => {
  const b = (await req.json().catch(() => {
    throw new HttpError(400, "bad_json");
  })) as { weddingId?: unknown; title?: unknown; quantity?: unknown };
  if (typeof b.title !== "string") throw new HttpError(400, "bad_title");
  if (b.weddingId !== undefined && typeof b.weddingId !== "string") throw new HttpError(400, "bad_wedding");
  const quantity = b.quantity === undefined ? 1 : b.quantity;
  if (typeof quantity !== "number") throw new HttpError(400, "bad_quantity");
  const weddingId = await addRegistryItem(viewer.id, { weddingId: b.weddingId as string | undefined, title: b.title, quantity });
  return { summary: await familyGuestSummary(viewer.id, weddingId) };
});
