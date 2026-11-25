import { dictateFamilyNote } from "@/lib/server/family-voice";
import { authed } from "@/lib/server/route";
import { voiceClipForm } from "@/lib/server/sarvam-models";

export const POST = authed(async (req, viewer) => {
  const { audio, language, weddingId } = await voiceClipForm(req);
  return dictateFamilyNote(viewer.id, weddingId, audio, language);
});
