import { jsonObject } from "@/lib/server/request-body";
import { authed } from "@/lib/server/route";
import { addFact, planView } from "@/lib/server/plan";
import { HttpError } from "@/lib/server/weddings";
import { parseFactInput } from "@/lib/plan-input";

/** A new fact triggers a recompile: the response is the fresh plan. */
export const POST = authed(async (req, viewer) => {
  const body = await jsonObject(req, undefined, "bad_json");
  const parsed = parseFactInput(body);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  const weddingId = await addFact(viewer.id, parsed.value);
  return { plan: await planView(viewer.id, weddingId) };
});
