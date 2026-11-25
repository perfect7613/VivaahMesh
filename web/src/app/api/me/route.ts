import { authed } from "@/lib/server/route";
import { weddingView } from "@/lib/server/weddings";

export const GET = authed(async (req, viewer) => {
  const weddingId = new URL(req.url).searchParams.get("wedding") ?? undefined;
  return Response.json(
    { view: await weddingView(viewer.id, weddingId), botUsername: process.env.TELEGRAM_BOT_USERNAME },
    { headers: { "cache-control": "private, no-store" } },
  );
});
