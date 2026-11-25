import { browserSession, callResponse } from "@/lib/server/browser-calls";

export async function GET(req: Request, ctx: RouteContext<"/api/calls/browser/[...path]">) {
  const { path } = await ctx.params;
  return callResponse(() => browserSession(req.headers.get("x-call-consent") ?? "", path, req.url));
}
