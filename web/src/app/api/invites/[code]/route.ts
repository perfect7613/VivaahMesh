import { authed } from "@/lib/server/route";
import { invitePreview, HttpError } from "@/lib/server/weddings";

export const GET = authed<{ params: Promise<{ code: string }> }>(async (_req, _viewer, ctx) => {
  const { code } = await ctx.params;
  const p = await invitePreview(code);
  if (!p) throw new HttpError(404, "invite_not_found");
  return {
    kind: p.kind,
    family: p.family,
    couple: `${p.wedding.partner_a} & ${p.wedding.partner_b}`,
    date: p.wedding.wedding_date,
    city: p.wedding.city,
  };
});
