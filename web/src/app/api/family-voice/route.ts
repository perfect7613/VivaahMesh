import { familyVoiceBody, familyVoiceView, publishFamilyRequirement } from "@/lib/server/family-voice";
import { authed } from "@/lib/server/route";

export const GET = authed(async (req, viewer) => familyVoiceView(viewer.id, new URL(req.url).searchParams.get("wedding")));
export const POST = authed(async (req, viewer) => publishFamilyRequirement(viewer.id, await familyVoiceBody(req)));
