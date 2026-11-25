import { authed } from "@/lib/server/route";
import { approveRevision, planView } from "@/lib/server/plan";
import { HttpError } from "@/lib/server/weddings";
import { parseApproveInput } from "@/lib/revisions";

/** Couple approval of one exact revision. 409 + the newer plan if a newer revision exists. */
export const POST = authed(async (req, viewer) => {
  const body = await req.json().catch(() => {
    throw new HttpError(400, "bad_json");
  });
  const parsed = parseApproveInput(body);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  const out = await approveRevision(viewer.id, parsed.value);
  const plan = await planView(viewer.id, out.weddingId);
  return out.status === "stale" ? Response.json({ error: "stale", plan }, { status: 409 }) : { plan };
});
