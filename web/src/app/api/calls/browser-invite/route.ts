import { authed } from "@/lib/server/route";
import { browserInvite, jsonObject } from "@/lib/server/browser-calls";

export const POST = authed(async (req, viewer) => browserInvite(viewer.id, await jsonObject(req)));
