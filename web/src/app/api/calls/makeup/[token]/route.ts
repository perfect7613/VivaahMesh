import { makeupReplyView, makeupResponse, recordMakeupReply } from "@/lib/server/makeup-enquiries";
import { HttpError } from "@/lib/server/weddings";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return makeupResponse(() => makeupReplyView(token));
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return makeupResponse(async () => {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_makeup_reply");
    return recordMakeupReply(token, body as Record<string, unknown>);
  });
}
