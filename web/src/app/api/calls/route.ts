import { authed } from "@/lib/server/route";
import { authorizeCall, callPreview } from "@/lib/server/calls";

/** Who will be called, why, and whether dialing is currently allowed (Flagsmith kill switch). */
export const GET = authed(async (req, viewer) => {
  const weddingId = new URL(req.url).searchParams.get("wedding") ?? undefined;
  return callPreview(viewer.id, weddingId);
});

/** A parent or the couple authorizes the call. Generating a proposal never dials; only this does. */
export const POST = authed(async (req, viewer) => {
  const body = (await req.json().catch(() => ({}))) as { weddingId?: string };
  const call = await authorizeCall(viewer.id, body.weddingId);
  return { call: { id: call.id, status: call.status, error: call.error } };
});
