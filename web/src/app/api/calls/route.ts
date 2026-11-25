import { voiceJsonObject } from "@/lib/server/voice-request";
import { HttpError } from "@/lib/server/weddings";
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
  const { weddingId, rehearsalOnly, previewToken } = await voiceJsonObject(req);
  if (weddingId !== undefined && typeof weddingId !== "string") throw new HttpError(400, "invalid_wedding");
  if (rehearsalOnly !== undefined && typeof rehearsalOnly !== "boolean") throw new HttpError(400, "invalid_rehearsal_mode");
  const call = await authorizeCall(viewer.id, weddingId, rehearsalOnly === true, previewToken);
  if ("rehearsal" in call && call.rehearsal && call.status === "dialing") {
    // Rehearsal: the "venue" answers after a few seconds through the same store → apply path.
    after(async () => {
      await new Promise((r) => setTimeout(r, 9000));
      await simulateRehearsalAnswer(call.id).catch(() => console.error("rehearsal answer failed"));
    });
  }
  return { call: { id: call.id, status: call.status, error: call.error } };
});
