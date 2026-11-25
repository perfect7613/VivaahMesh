import { callResponse, consentToVenueCall, consentView, jsonObject } from "@/lib/server/browser-calls";

export async function GET(_req: Request, ctx: RouteContext<"/api/calls/consent/[token]">) {
  const { token } = await ctx.params;
  return callResponse(() => consentView(token));
}

export async function POST(req: Request, ctx: RouteContext<"/api/calls/consent/[token]">) {
  const { token } = await ctx.params;
  return callResponse(async () => consentToVenueCall(token, await jsonObject(req)));
}
