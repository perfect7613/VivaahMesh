import { authed } from "@/lib/server/route";
import { addPriorities, memberships, weddingView, HttpError } from "@/lib/server/weddings";

import { jsonObject } from "@/lib/server/request-body";
import { stringList, textField, uuidField, visibilityField } from "@/lib/server/wedding-input";

export const POST = authed(async (req, viewer) => {
  const body = await jsonObject(req);
  const weddingId = uuidField(body, "weddingId", true);
  const me = (await memberships(viewer.id)).find((m) => !weddingId || m.wedding_id === weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  await addPriorities(
    me,
    stringList(body, "priorities", 12),
    textField(body, "note"),
    visibilityField(body),
    "app",
  );
  return { view: await weddingView(viewer.id, me.wedding_id) };
});
