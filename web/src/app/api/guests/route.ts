import { authed } from "@/lib/server/route";
import { addGuest, familyGuestSummary } from "@/lib/server/guests";
import { HttpError } from "@/lib/server/weddings";

/** The family's guest summary: totals per function, who answered, who reserved which gift. */
export const GET = authed(async (req, viewer) => {
  const weddingId = new URL(req.url).searchParams.get("wedding") ?? undefined;
  return { summary: await familyGuestSummary(viewer.id, weddingId) };
});

/** Add a guest; the response carries their access link code. */
export const POST = authed(async (req, viewer) => {
  const b = (await req.json().catch(() => {
    throw new HttpError(400, "bad_json");
  })) as { weddingId?: unknown; name?: unknown; side?: unknown };
  if (typeof b.name !== "string") throw new HttpError(400, "bad_name");
  if (b.weddingId !== undefined && typeof b.weddingId !== "string") throw new HttpError(400, "bad_wedding");
  if (b.side !== undefined && b.side !== "A" && b.side !== "B") throw new HttpError(400, "bad_side");
  const added = await addGuest(viewer.id, { weddingId: b.weddingId as string | undefined, name: b.name, side: b.side as "A" | "B" | undefined });
  return { guest: { id: added.guestId, accessCode: added.accessCode }, summary: await familyGuestSummary(viewer.id, added.weddingId) };
});
