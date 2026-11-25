import { voiceJsonObject } from "@/lib/server/voice-request";
import { authed } from "@/lib/server/route";
import { browserInvite } from "@/lib/server/browser-calls";

export const POST = authed(async (req, viewer) => browserInvite(viewer.id, await voiceJsonObject(req)));
