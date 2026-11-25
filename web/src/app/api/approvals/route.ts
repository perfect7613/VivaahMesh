import { after } from "next/server";
import { authed } from "@/lib/server/route";
import { approveRevision, planView } from "@/lib/server/plan";
import { HttpError } from "@/lib/server/weddings";
import { runAgent } from "@/lib/server/agent";
import { parseApproveInput } from "@/lib/revisions";

export const maxDuration = 60;

/**
 * The couple approves one proposal of one exact plan revision (issue #5). If a newer revision
 * exists (a late vendor reply, a changed fact), nothing changes and the answer is 409 with the
 * newer plan, so the screen can show it. An approval applies the move to the committed timeline and
 * stores who approved, which revision and the Flagsmith snapshot. The agent then tells both families.
 * `/api/plan/approve` is an alias of this route.
 */
export const POST = authed(async (req, viewer) => {
  const body = await req.json().catch(() => {
    throw new HttpError(400, "bad_json");
  });
  const parsed = parseApproveInput(body);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  const out = await approveRevision(viewer.id, parsed.value);
  const plan = await planView(viewer.id, out.weddingId);
  if (out.status === "stale") return Response.json({ error: "stale", plan }, { status: 409 });
  after(() => runAgent(out.weddingId, "approval").catch((e) => console.error("agent after approval", e)));
  return { plan };
});
