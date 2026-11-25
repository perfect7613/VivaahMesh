import { dictateMakeupReply, makeupResponse } from "@/lib/server/makeup-enquiries";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return makeupResponse(() => dictateMakeupReply(token, req));
}
