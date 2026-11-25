import { after } from "next/server";
import { callResponse, jsonObject, processVenueResult, saveBrowserResult } from "@/lib/server/browser-calls";

export async function POST(req: Request, ctx: RouteContext<"/api/calls/consent/[token]/browser-result">) {
  const { token } = await ctx.params;
  return callResponse(async () => {
    const resultId = await saveBrowserResult(token, await jsonObject(req));
    after(() => processVenueResult(resultId).catch(() => console.error("Saved browser result requires replay.")));
    return { accepted: true };
  });
}
