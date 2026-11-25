import { jsonObject } from "@/lib/server/request-body";
import { authed } from "@/lib/server/route";
import { planView, respondToRevision } from "@/lib/server/plan";
import { HttpError } from "@/lib/server/weddings";
import { parseRespondInput } from "@/lib/revisions";

/** A household's response to the current revision. 409 + the newer plan if the revision is outdated. */
export const POST = authed(async (req, viewer) => {
  const body = await jsonObject(req, undefined, "bad_json");
  const parsed = parseRespondInput(body);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  const out = await respondToRevision(viewer.id, parsed.value);
  const plan = await planView(viewer.id, out.weddingId);
  return out.status === "stale" ? Response.json({ error: "stale", plan }, { status: 409 }) : { plan };
});
