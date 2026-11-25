import { jsonObject } from "@/lib/server/request-body";
import { takeAgentRequest } from "@/lib/server/request-quota";
import { authed } from "@/lib/server/route";
import { runAgent } from "@/lib/server/agent";
import { HttpError, memberships } from "@/lib/server/weddings";

export const maxDuration = 60;

/** Ask the planning agent anything from inside the Mini App. It can read the plan and search the web. */
export const POST = authed(async (req, viewer) => {
  const b = await jsonObject(req, 8192);
  if (b.weddingId !== undefined && typeof b.weddingId !== "string") throw new HttpError(400, "invalid_wedding");
  const question = typeof b.question === "string" ? b.question.trim().slice(0, 1000) : "";
  if (!question) throw new HttpError(400, "question_required");
  const me = (await memberships(viewer.id)).find((m) => !b.weddingId || m.wedding_id === b.weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  if (!(await takeAgentRequest(viewer.id))) throw new HttpError(429, "agent_request_limit");
  const r = await runAgent(me.wedding_id, "message", { senderMemberId: me.id, note: question, chatId: `app:${me.id}` });
  if (r.status !== "done") return { answer: null, busy: true, reason: r.reason };
  return { answer: r.replies.join("\n\n") || null, searched: r.searched, notesSaved: r.notesSaved };
});
