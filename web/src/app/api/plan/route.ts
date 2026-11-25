import { jsonObject } from "@/lib/server/request-body";
import { authed } from "@/lib/server/route";
import { uuidField } from "@/lib/server/wedding-input";
import { planView, seedDemoPlan } from "@/lib/server/plan";

export const GET = authed(async (req, viewer) => {
  const weddingId = new URL(req.url).searchParams.get("wedding") ?? undefined;
  return { plan: await planView(viewer.id, weddingId) };
});

/** Couple-only: seed the labelled demo Sangeet into this wedding. */
export const POST = authed(async (req, viewer) => {
  const body = await jsonObject(req);
  const id = await seedDemoPlan(viewer.id, uuidField(body, "weddingId", true));
  return { plan: await planView(viewer.id, id) };
});
