import "server-only";
import { db } from "./supabase";
import type { Lang } from "@/lib/i18n";

export const FUNCTION_KINDS = ["haldi", "mehendi", "sangeet", "ceremony", "reception", "engagement"] as const;
export type FunctionKind = (typeof FUNCTION_KINDS)[number];
const FUNCTION_TITLES: Record<FunctionKind, string> = {
  haldi: "Haldi", mehendi: "Mehendi", sangeet: "Sangeet",
  ceremony: "Ceremony", reception: "Reception", engagement: "Engagement",
};

export interface CreateWeddingInput {
  partnerA: string;
  partnerB: string;
  weddingDate?: string | null;
  city?: string | null;
  functions: FunctionKind[];
  guestCount?: number | null;
  budgetInr?: number | null;
  myFamily: string;
  otherFamily: string;
  displayName: string;
  language: Lang;
}

function clean(s: unknown, max = 80): string {
  return String(s ?? "").trim().slice(0, max);
}

export async function createWedding(tgUserId: number, input: CreateWeddingInput) {
  const partnerA = clean(input.partnerA, 40);
  const partnerB = clean(input.partnerB, 40);
  const myFamily = clean(input.myFamily, 60);
  const otherFamily = clean(input.otherFamily, 60);
  if (!partnerA || !partnerB || !myFamily || !otherFamily) throw new HttpError(400, "missing_fields");

  const s = db();
  const { data: wedding, error } = await s
    .from("weddings")
    .insert({
      partner_a: partnerA,
      partner_b: partnerB,
      wedding_date: input.weddingDate || null,
      city: clean(input.city, 60) || null,
      guest_count: input.guestCount ?? null,
      budget_inr: input.budgetInr ?? null,
      created_by_tg: tgUserId,
    })
    .select()
    .single();
  if (error) throw error;

  const { data: households, error: hErr } = await s
    .from("households")
    .insert([
      { wedding_id: wedding.id, side: "A", name: myFamily },
      { wedding_id: wedding.id, side: "B", name: otherFamily },
    ])
    .select();
  if (hErr) throw hErr;
  const mine = households.find((h) => h.side === "A")!;

  const kinds = input.functions.filter((k) => FUNCTION_KINDS.includes(k));
  if (kinds.length) {
    const { error: fErr } = await s.from("functions").insert(
      kinds.map((k, i) => ({ wedding_id: wedding.id, kind: k, title: FUNCTION_TITLES[k], sort: i })),
    );
    if (fErr) throw fErr;
  }

  const { data: member, error: mErr } = await s
    .from("members")
    .insert({
      wedding_id: wedding.id,
      household_id: mine.id,
      tg_user_id: tgUserId,
      display_name: clean(input.displayName, 40) || partnerA,
      role: "couple",
      is_couple: true,
      language: input.language,
    })
    .select()
    .single();
  if (mErr) throw mErr;

  await logEvent(wedding.id, member.id, "wedding_created", {});
  return { weddingId: wedding.id as string };
}

/** Public preview of an invite: just enough to say whose wedding and which family. */
export async function invitePreview(code: string) {
  const s = db();
  const { data: h } = await s
    .from("households")
    .select("id, name, side, wedding:weddings(id, partner_a, partner_b, wedding_date, city)")
    .eq("invite_code", code)
    .maybeSingle();
  if (h) {
    const w = h.wedding as unknown as { id: string; partner_a: string; partner_b: string; wedding_date: string | null; city: string | null };
    return { kind: "household" as const, householdId: h.id as string, family: h.name as string, wedding: w };
  }
  const { data: w } = await s
    .from("weddings")
    .select("id, partner_a, partner_b, wedding_date, city, households(id, name, side)")
    .eq("couple_code", code)
    .maybeSingle();
  if (w) {
    const hs = (w.households as { id: string; name: string; side: string }[]) ?? [];
    const b = hs.find((x) => x.side === "B");
    return { kind: "couple" as const, householdId: b?.id ?? null, family: b?.name ?? "", wedding: w };
  }
  return null;
}

export interface JoinInput {
  code: string;
  displayName: string;
  role: string;
  language: Lang;
  priorities: string[];
  note?: string;
  visibility: "shared" | "household";
}

const ROLES = ["parent", "grandparent", "sibling", "cousin", "relative", "friend", "couple"];

export async function joinWedding(tgUserId: number, input: JoinInput) {
  const preview = await invitePreview(clean(input.code, 40));
  if (!preview) throw new HttpError(404, "invite_not_found");
  const s = db();
  const isCouple = preview.kind === "couple";
  const role = isCouple ? "couple" : ROLES.includes(input.role) ? input.role : "family";

  const { data: member, error } = await s
    .from("members")
    .upsert(
      {
        wedding_id: preview.wedding.id,
        household_id: preview.householdId,
        tg_user_id: tgUserId,
        display_name: clean(input.displayName, 40) || "Family",
        role,
        is_couple: isCouple,
        language: input.language,
      },
      { onConflict: "wedding_id,tg_user_id" },
    )
    .select()
    .single();
  if (error) throw error;

  await addPriorities(member, input.priorities, input.note, input.visibility, "app");
  await logEvent(preview.wedding.id, member.id, "member_joined", { family: preview.family });
  return { weddingId: preview.wedding.id as string, memberId: member.id as string };
}

type MemberRow = { id: string; wedding_id: string; household_id: string | null };

export async function addPriorities(
  member: MemberRow,
  presetKeys: string[],
  note: string | undefined,
  visibility: "shared" | "household",
  source: "app" | "telegram" | "whatsapp" | "voice",
) {
  const rows = [
    ...presetKeys.slice(0, 12).map((k) => ({ kind: clean(k, 40), note: null as string | null })),
    ...(clean(note, 500) ? [{ kind: "note", note: clean(note, 500) }] : []),
  ].map((r) => ({
    ...r,
    wedding_id: member.wedding_id,
    household_id: member.household_id,
    member_id: member.id,
    source,
    visibility: visibility === "household" ? "household" : "shared",
  }));
  if (!rows.length) return;
  const { error } = await db().from("priorities").insert(rows);
  if (error) throw error;
}

export async function memberships(tgUserId: number) {
  const { data, error } = await db()
    .from("members")
    .select("id, wedding_id, household_id, display_name, language, is_couple, role, created_at")
    .eq("tg_user_id", tgUserId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Everything the home screen needs, filtered for this viewer:
 * budget only for the couple, household-private priorities only for that household.
 */
export async function weddingView(tgUserId: number, weddingId?: string) {
  const mine = await memberships(tgUserId);
  const me = weddingId ? mine.find((m) => m.wedding_id === weddingId) : mine[0];
  if (!me) return null;
  const s = db();
  const [w, hs, ms, fs, ps] = await Promise.all([
    s.from("weddings").select("*").eq("id", me.wedding_id).single(),
    s.from("households").select("id, side, name, invite_code").eq("wedding_id", me.wedding_id).order("side"),
    s.from("members").select("id, household_id, display_name, role, is_couple, language").eq("wedding_id", me.wedding_id),
    s.from("functions").select("id, kind, title, sort").eq("wedding_id", me.wedding_id).order("sort"),
    s.from("priorities").select("id, household_id, member_id, kind, note, visibility, source, created_at").eq("wedding_id", me.wedding_id).order("created_at", { ascending: false }),
  ]);
  for (const r of [w, hs, ms, fs, ps]) if (r.error) throw r.error;
  const wedding = w.data!;

  return {
    me: { id: me.id, householdId: me.household_id, displayName: me.display_name, language: me.language, isCouple: me.is_couple, role: me.role },
    wedding: {
      id: wedding.id,
      partnerA: wedding.partner_a,
      partnerB: wedding.partner_b,
      date: wedding.wedding_date,
      city: wedding.city,
      guestCount: wedding.guest_count,
      budgetInr: me.is_couple ? wedding.budget_inr : null,
      stage: wedding.stage,
      coupleCode: me.is_couple ? wedding.couple_code : null,
    },
    households: (hs.data ?? []).map((h) => ({
      id: h.id,
      side: h.side,
      name: h.name,
      // Each family may invite to its own side; the couple can invite to both.
      inviteCode: me.is_couple || me.household_id === h.id ? h.invite_code : null,
      members: (ms.data ?? []).filter((m) => m.household_id === h.id).map((m) => ({ id: m.id, name: m.display_name, role: m.role, isCouple: m.is_couple })),
    })),
    functions: fs.data ?? [],
    priorities: (ps.data ?? [])
      .filter((p) => p.visibility === "shared" || p.household_id === me.household_id)
      .map((p) => {
        const author = (ms.data ?? []).find((m) => m.id === p.member_id);
        const fam = (hs.data ?? []).find((h) => h.id === p.household_id);
        return { id: p.id, kind: p.kind, note: p.note, visibility: p.visibility, source: p.source, author: author?.display_name ?? "", family: fam?.name ?? "", createdAt: p.created_at };
      }),
  };
}
export type WeddingView = NonNullable<Awaited<ReturnType<typeof weddingView>>>;

export async function logEvent(weddingId: string, memberId: string | null, kind: string, payload: Record<string, unknown>) {
  await db().from("events").insert({ wedding_id: weddingId, actor_member_id: memberId, kind, payload });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
