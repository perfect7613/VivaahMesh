import { authed } from "@/lib/server/route";
import { addPriorities, memberships, weddingView, HttpError } from "@/lib/server/weddings";

export const POST = authed(async (req, viewer) => {
  const body = (await req.json()) as { weddingId?: string; priorities?: string[]; note?: string; visibility?: string };
  const me = (await memberships(viewer.id)).find((m) => !body.weddingId || m.wedding_id === body.weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  await addPriorities(
    me,
    Array.isArray(body.priorities) ? body.priorities : [],
    body.note,
    body.visibility === "household" ? "household" : "shared",
    "app",
  );
  return { view: await weddingView(viewer.id, me.wedding_id) };
});
