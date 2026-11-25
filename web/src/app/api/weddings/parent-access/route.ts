import { jsonObject } from "@/lib/server/request-body";
import { authed } from "@/lib/server/route";
import { HttpError, setParentAccess, weddingView } from "@/lib/server/weddings";

import { uuidField } from "@/lib/server/wedding-input";

export const PATCH = authed(async (req, viewer) => {
  const input = await jsonObject(req);
  if (typeof input.granted !== "boolean") {
    throw new HttpError(400, "bad_parent_access_request");
  }
  const weddingId = uuidField(input, "weddingId");
  await setParentAccess(viewer.id, weddingId, uuidField(input, "memberId"), input.granted);
  return { view: await weddingView(viewer.id, weddingId) };
});
