import { authed } from "@/lib/server/route";
import { after } from "next/server";
import { authorizeCall, callPreview, simulateRehearsalAnswer } from "@/lib/server/calls";

export const maxDuration = 60;

/** Who will be called, why, and whether dialing is currently allowed (Flagsmith kill switch). */
export const GET = authed(async (req, viewer) => {
  const weddingId = new URL(req.url).searchParams.get("wedding") ?? undefined;
  return callPreview(viewer.id, weddingId);
});

/** A parent or the couple authorizes the call. Generating a proposal never dials; only this does. */
export const POST = authed(async (req, viewer) => {
  const body = (await req.json().catch(() => ({}))) as { weddingId?: string };
  const call = await authorizeCall(viewer.id, body.weddingId);
  if ("rehearsal" in call && call.rehearsal && call.status === "dialing") {
    // Rehearsal: the "venue" answers after a few seconds through the same store → apply path.
    after(async () => {
      await new Promise((r) => setTimeout(r, 9000));
      await simulateRehearsalAnswer(call.id).catch((e) => console.error("rehearsal answer failed", e));
    });
  }
  return { call: { id: call.id, status: call.status, error: call.error } };
});
