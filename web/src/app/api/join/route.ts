import { after } from "next/server";
import { authed } from "@/lib/server/route";
import { joinWedding, weddingView, type JoinInput } from "@/lib/server/weddings";
import { notifyWedding } from "@/lib/server/notify";
import { pickLang } from "@/lib/i18n";

export const POST = authed(async (req, viewer) => {
  const body = (await req.json()) as JoinInput;
  const { weddingId, memberId } = await joinWedding(viewer.id, {
    ...body,
    displayName: body.displayName || viewer.first_name,
    priorities: Array.isArray(body.priorities) ? body.priorities : [],
    language: pickLang(body.language),
    visibility: body.visibility === "household" ? "household" : "shared",
  });
  const view = await weddingView(viewer.id, weddingId);
  // Let everyone else know, in their own language, after responding. Never fail the join on this.
  after(() => notifyWedding(weddingId, memberId, "joined").catch((e) => console.error("notify failed", e)));
  return { view };
});
