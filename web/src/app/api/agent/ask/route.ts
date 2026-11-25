import { authed } from "@/lib/server/route";
import { runAgent } from "@/lib/server/agent";
import { HttpError, memberships } from "@/lib/server/weddings";

export const maxDuration = 60;

/** Ask the planning agent anything from inside the Mini App. It can read the plan and search the web. */
export const POST = authed(async (req, viewer) => {
  const b = (await req.json().catch(() => ({}))) as { weddingId?: string; question?: string };
  const question = String(b.question ?? "").trim().slice(0, 1000);
  if (!question) throw new HttpError(400, "question_required");
  const me = (await memberships(viewer.id)).find((m) => !b.weddingId || m.wedding_id === b.weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  const r = await runAgent(me.wedding_id, "message", { senderMemberId: me.id, note: question, chatId: `app:${me.id}` });
  if (r.status !== "done") return { answer: null, busy: true, reason: r.reason };
  const searched = r.actions.filter((a) => a.tool === "web_search").map((a) => String(a.query ?? ""));
  return { answer: r.replies.join("\n\n") || null, searched, notesSaved: r.notesSaved };
});
