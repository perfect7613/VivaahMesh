import { publicRoute } from "@/lib/server/public-route";
import { guestReserve, guestRsvp, guestView } from "@/lib/server/lifecycle";

type Ctx = { params: Promise<{ token: string }> };

export const GET = publicRoute<Ctx>(async (_req, { params }) => guestView((await params).token));

export const POST = publicRoute<Ctx>(async (req, { params }) => {
  const { token } = await params;
  const b = (await req.json().catch(() => ({}))) as { functionId?: string; attending?: boolean; people?: number; veg?: number; reserve?: string };
  if (b.reserve) return guestReserve(token, String(b.reserve));
  return guestRsvp(token, String(b.functionId ?? ""), !!b.attending, Number(b.people ?? 1), Number(b.veg ?? 0));
});
