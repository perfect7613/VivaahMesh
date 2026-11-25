import { authed } from "@/lib/server/route";
import { planView, seedDemoPlan } from "@/lib/server/plan";

export const GET = authed(async (req, viewer) => {
  const weddingId = new URL(req.url).searchParams.get("wedding") ?? undefined;
  return { plan: await planView(viewer.id, weddingId) };
});

/** Couple-only: seed the labelled demo Sangeet into this wedding. */
export const POST = authed(async (req, viewer) => {
  const body = (await req.json().catch(() => ({}))) as { weddingId?: string };
  const id = await seedDemoPlan(viewer.id, body.weddingId);
  return { plan: await planView(viewer.id, id) };
});
