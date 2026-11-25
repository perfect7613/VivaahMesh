import { after } from "next/server";
import { authed } from "@/lib/server/route";
import { approveProposal, planView } from "@/lib/server/plan";
import { runAgent } from "@/lib/server/agent";

export const maxDuration = 60;

/** The couple approves a proposal on the revision they saw. The agent then tells both families. */
export const POST = authed(async (req, viewer) => {
  const b = (await req.json().catch(() => ({}))) as { weddingId?: string; proposalId?: string; snapshotRevision?: number };
  const weddingId = await approveProposal(viewer.id, { weddingId: b.weddingId, proposalId: String(b.proposalId ?? ""), snapshotRevision: Number(b.snapshotRevision) });
  after(() => runAgent(weddingId, "approval").catch((e) => console.error("agent after approval", e)));
  return { plan: await planView(viewer.id, weddingId) };
});
