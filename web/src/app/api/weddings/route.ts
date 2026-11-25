import { authed } from "@/lib/server/route";
import { createWedding, weddingView, type CreateWeddingInput } from "@/lib/server/weddings";
import { pickLang } from "@/lib/i18n";

export const POST = authed(async (req, viewer) => {
  const body = (await req.json()) as CreateWeddingInput;
  const { weddingId } = await createWedding(viewer.id, {
    ...body,
    functions: Array.isArray(body.functions) ? body.functions : [],
    guestCount: Number.isFinite(body.guestCount) ? Math.round(Number(body.guestCount)) : null,
    budgetInr: Number.isFinite(body.budgetInr) ? Math.round(Number(body.budgetInr)) : null,
    displayName: body.displayName || viewer.first_name,
    language: pickLang(body.language),
  });
  return { view: await weddingView(viewer.id, weddingId) };
});
