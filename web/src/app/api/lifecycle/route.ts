import { authed } from "@/lib/server/route";
import { jsonObject } from "@/lib/server/request-body";
import { HttpError } from "@/lib/server/weddings";
import { uuidField } from "@/lib/server/wedding-input";
import { lifecycleAction, lifecycleView } from "@/lib/server/lifecycle";

export const maxDuration = 30;

export const GET = authed(async (req, viewer) => ({
  lifecycle: await lifecycleView(viewer.id, uuidField({ weddingId: new URL(req.url).searchParams.get("wedding") }, "weddingId", true)),
}));

export const POST = authed(async (req, viewer) => {
  const b = await jsonObject(req);
  if (!b.action || typeof b.action !== "object" || Array.isArray(b.action)) throw new HttpError(400, "action_required");
  return { lifecycle: await lifecycleAction(viewer.id, uuidField(b, "weddingId", true), b.action as Record<string, unknown>) };
});
