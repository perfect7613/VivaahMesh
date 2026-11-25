import { authed } from "@/lib/server/route";
import { lifecycleAction, lifecycleView } from "@/lib/server/lifecycle";

export const maxDuration = 30;

export const GET = authed(async (req, viewer) => ({ lifecycle: await lifecycleView(viewer.id, new URL(req.url).searchParams.get("wedding") ?? undefined) }));

export const POST = authed(async (req, viewer) => {
  const b = (await req.json().catch(() => ({}))) as { weddingId?: string; action?: Parameters<typeof lifecycleAction>[2] };
  if (!b.action || typeof b.action !== "object") return Response.json({ error: "action_required" }, { status: 400 });
  return { lifecycle: await lifecycleAction(viewer.id, b.weddingId, b.action) };
});
