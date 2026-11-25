import { voiceJsonObject } from "@/lib/server/voice-request";
import { authed } from "@/lib/server/route";
import { askMakeupArtist } from "@/lib/server/makeup-enquiries";
import { planView } from "@/lib/server/plan";
import { canManageWedding, HttpError, memberships } from "@/lib/server/weddings";

export const POST = authed(async (req, viewer) => {
  const body = await voiceJsonObject(req);
  if (typeof body.weddingId !== "string" || typeof body.proposalId !== "string"
    || typeof body.readyBy !== "number") throw new HttpError(400, "invalid_makeup_request");
  const me = (await memberships(viewer.id)).find((member) => member.wedding_id === body.weddingId);
  if (!me || !canManageWedding(me)) throw new HttpError(403, "makeup_request_role_required");
  const plan = await planView(viewer.id, me.wedding_id);
  const proposal = plan?.result.conditional.find((item) => item.id === body.proposalId
    && item.missing.factKind === "makeup_ready" && item.missing.byMinute === body.readyBy);
  if (!plan || !proposal) throw new HttpError(409, "makeup_proposal_changed");
  const dance = plan.activities.find((activity) => activity.kind === "dance"
    && proposal.moves.some((move) => move.activityId === activity.id));
  if (!dance) throw new HttpError(409, "makeup_proposal_changed");
  return askMakeupArtist({
    weddingId: me.wedding_id, memberId: me.id, functionKind: dance.functionKind,
    proposalId: proposal.id, artist: proposal.missing.askWhom, readyBy: body.readyBy,
  });
});
