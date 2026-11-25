import { authed } from "@/lib/server/route";
import { createWedding, weddingView } from "@/lib/server/weddings";
import { jsonObject } from "@/lib/server/request-body";
import { dateField, integerField, stringList, textField } from "@/lib/server/wedding-input";
import { pickLang } from "@/lib/i18n";

export const POST = authed(async (req, viewer) => {
  const body = await jsonObject(req);
  const { weddingId } = await createWedding(viewer.id, {
    partnerA: textField(body, "partnerA") ?? "",
    partnerB: textField(body, "partnerB") ?? "",
    myFamily: textField(body, "myFamily") ?? "",
    otherFamily: textField(body, "otherFamily") ?? "",
    weddingDate: dateField(body, "weddingDate"),
    city: textField(body, "city"),
    functions: stringList(body, "functions", 16),
    guestCount: integerField(body, "guestCount", 1, 5000),
    budgetInr: integerField(body, "budgetInr", 0, Number.MAX_SAFE_INTEGER),
    displayName: textField(body, "displayName") || viewer.first_name,
    language: pickLang(textField(body, "language")),
  });
  return { view: await weddingView(viewer.id, weddingId) };
});
