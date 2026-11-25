import { makeupReplyView, makeupResponse, recordMakeupReply } from "@/lib/server/makeup-enquiries";
import { voiceJsonObject } from "@/lib/server/voice-request";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return makeupResponse(() => makeupReplyView(token));
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return makeupResponse(async () => recordMakeupReply(token, await voiceJsonObject(req)));
}
