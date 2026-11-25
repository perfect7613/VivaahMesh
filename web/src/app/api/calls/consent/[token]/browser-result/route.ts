import { voiceJsonObject } from "@/lib/server/voice-request";
import { after } from "next/server";
import { callResponse, saveBrowserResult } from "@/lib/server/browser-calls";
import { dispatchStoredResult } from "@/lib/server/calls";

export async function POST(req: Request, ctx: RouteContext<"/api/calls/consent/[token]/browser-result">) {
  const { token } = await ctx.params;
  return callResponse(async () => {
    const { callId, duplicate } = await saveBrowserResult(token, await voiceJsonObject(req));
    if (!duplicate) after(() => dispatchStoredResult(callId).catch(() => console.error("Saved browser result requires replay.")));
    return { accepted: true };
  });
}
