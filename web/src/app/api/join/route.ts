import { after } from "next/server";
import { authed } from "@/lib/server/route";
import { joinWedding, weddingView } from "@/lib/server/weddings";
import { notifyWedding } from "@/lib/server/notify";
import { jsonObject } from "@/lib/server/request-body";
import { stringList, textField, visibilityField } from "@/lib/server/wedding-input";
import { pickLang } from "@/lib/i18n";

export const POST = authed(async (req, viewer) => {
  const body = await jsonObject(req);
  const { weddingId, memberId, joined } = await joinWedding(viewer.id, {
    code: textField(body, "code") ?? "",
    displayName: textField(body, "displayName") || viewer.first_name,
    role: textField(body, "role") ?? "",
    priorities: stringList(body, "priorities", 12),
    note: textField(body, "note"),
    language: pickLang(textField(body, "language")),
    visibility: visibilityField(body),
  });
  const view = await weddingView(viewer.id, weddingId);
  // Let everyone else know, in their own language, after responding. Never fail the join on this.
  if (joined) after(() => notifyWedding(weddingId, memberId).catch(() => console.error("Join notification failed")));
  return { view };
});
