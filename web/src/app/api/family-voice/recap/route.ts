import { familyVoiceBody, playFamilyRecap } from "@/lib/server/family-voice";
import { authed } from "@/lib/server/route";

export const POST = authed(async (req, viewer) => {
  const { weddingId, revision } = await familyVoiceBody(req);
  return playFamilyRecap(viewer.id, weddingId, revision);
});
