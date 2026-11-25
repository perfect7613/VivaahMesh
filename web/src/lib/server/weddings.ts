import "server-only";
import { db } from "./supabase";
import type { Lang } from "@/lib/i18n";
import { HttpError } from "./http-error";
import { flagsFor } from "./flags";
import { takeRequestSlot } from "./request-quota";
import { SHARED_AGENT_TRIGGERS } from "./agent-scope";
import { pingWedding, weddingTopic } from "./wedding-live";

export { HttpError } from "./http-error";
export { pingWedding } from "./wedding-live";

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
  /** Preset kinds ("sangeet") or the family's own names ("Roka", "Jaggo"). */
  functions: string[];
  guestCount?: number | null;
  budgetInr?: number | null;
  myFamily: string;
  otherFamily: string;
  displayName: string;
  language: Lang;
}

function clean(s: unknown, max = 80): string {
  return typeof s === "string" ? s.trim().slice(0, max).replace(/[\u0000\uD800-\uDFFF]/gu, "") : "";
}

export async function createWedding(tgUserId: number, input: CreateWeddingInput) {
  const partnerA = clean(input.partnerA, 40);
  const partnerB = clean(input.partnerB, 40);
  const myFamily = clean(input.myFamily, 60);
  const otherFamily = clean(input.otherFamily, 60);
  if (!partnerA || !partnerB || !myFamily || !otherFamily) throw new HttpError(400, "missing_fields");

  const seen = new Set<string>();
  const fnRows = (input.functions ?? [])
    .slice(0, 16)
    .map((f) => {
      const known = (FUNCTION_KINDS as readonly string[]).includes(f) ? (f as FunctionKind) : null;
      const title = known ? FUNCTION_TITLES[known] : clean(f, 40);
      return title ? { kind: known ?? "other", title } : null;
    })
    .filter((r): r is { kind: string; title: string } => !!r && !seen.has(r.title.toLowerCase()) && !!seen.add(r.title.toLowerCase()));
  if (!await takeRequestSlot(`tg:${tgUserId}`, "create-wedding", 5, 86400)) throw new HttpError(429, "wedding_creation_limit");
  const { data: weddingId, error } = await db().rpc("create_wedding", {
    p_telegram: tgUserId, p_partner_a: partnerA, p_partner_b: partnerB, p_date: input.weddingDate || null,
    p_city: clean(input.city, 60) || null, p_guests: input.guestCount ?? null, p_budget: input.budgetInr ?? null,
    p_family_a: myFamily, p_family_b: otherFamily, p_name: clean(input.displayName, 40) || partnerA,
    p_language: input.language, p_functions: fnRows,
  });
  if (error) throw error;
  return { weddingId: weddingId as string };
}

async function takeInviteLookup(tgUserId: number) {
  if (!await takeRequestSlot(`tg:${tgUserId}`, "invite-lookup", 60, 3600)) throw new HttpError(429, "invite_lookup_limit");
}

/** Public preview of an invite: just enough to say whose wedding and which family. */
export async function invitePreview(code: string, tgUserId: number) {
  if (!/^(?:[0-9a-f]{10}|[0-9a-f]{32})$/.test(code)) return null;
  await takeInviteLookup(tgUserId);
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

export async function joinWedding(tgUserId: number, input: JoinInput) {
  const code = clean(input.code, 40);
  if (!/^(?:[0-9a-f]{10}|[0-9a-f]{32})$/.test(code)) throw new HttpError(404, "invite_not_found");
  await takeInviteLookup(tgUserId);
  const { data, error } = await db().rpc("join_wedding", {
    p_code: code,
    p_telegram: tgUserId,
    p_name: clean(input.displayName, 40) || "Family",
    p_role: clean(input.role, 16),
    p_language: input.language,
    p_priorities: priorityNotes(input.priorities, input.note),
    p_visibility: input.visibility,
  });
  if (error) throw error;
  if (data.status === "missing") throw new HttpError(404, "invite_not_found");
  if (data.status !== "joined" && data.status !== "existing") throw new HttpError(409, data.status);
  return { weddingId: data.weddingId as string, memberId: data.memberId as string, joined: data.status === "joined" };
}

function priorityNotes(presetKeys: string[], note?: string) {
  const message = clean(note, 500);
  return [
    ...presetKeys.slice(0, 12).map((k) => ({ kind: clean(k, 40), note: null })),
    ...(message ? [{ kind: "note", note: message }] : []),
  ];
}

type MemberRow = { id: string; wedding_id: string; household_id: string | null };

export async function addPriorities(
  member: MemberRow,
  presetKeys: string[],
  note: string | undefined,
  visibility: "shared" | "household",
  source: "app" | "telegram" | "whatsapp" | "voice",
) {
  if (visibility === "household" && !member.household_id) throw new HttpError(403, "no_household");
  const rows = priorityNotes(presetKeys, note).map((r) => ({
    ...r,
    wedding_id: member.wedding_id,
    household_id: member.household_id,
    member_id: member.id,
    source,
    visibility: visibility === "household" ? "household" : "shared",
  }));
  if (!rows.length) return null;
  const { data, error } = await db().from("priorities").insert(rows).select("id");
  if (error) throw error;
  await logEvent(member.wedding_id, member.id, "priority_added", { count: rows.length, source });
  return data?.at(-1)?.id as string | null;
}

export async function memberships(tgUserId: number) {
  const { data, error } = await db()
    .from("members")
    .select("id, wedding_id, household_id, display_name, language, is_couple, role, is_parent_delegate, created_at")
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
    s.from("members").select("id, household_id, display_name, role, is_couple, is_parent_delegate").eq("wedding_id", me.wedding_id),
    s.from("functions").select("id, kind, title, sort, on_date, starts_at, venue, details").eq("wedding_id", me.wedding_id).order("sort"),
    s.from("priorities").select("id, household_id, member_id, kind, note, visibility, source, created_at")
      .eq("wedding_id", me.wedding_id)
      .or(me.household_id ? `visibility.eq.shared,and(visibility.eq.household,household_id.eq.${me.household_id})` : "visibility.eq.shared")
      .order("created_at", { ascending: false }),
  ]);
  for (const r of [w, hs, ms, fs, ps]) if (r.error) throw r.error;
  const wedding = w.data!;
  const mySide = ((hs.data ?? []).find((h) => h.id === me.household_id)?.side ?? null) as "A" | "B" | null;
  const flags = await flagsFor({
    weddingId: wedding.id,
    memberId: me.id,
    language: me.language,
    householdSide: mySide,
    role: me.role,
    isCouple: me.is_couple,
    weddingStage: wedding.stage,
  });

  return {
    realtimeTopic: weddingTopic(wedding.id),
    flags: {
      source: flags.source,
      on: Object.fromEntries(Object.entries(flags.features).map(([k, v]) => [k, v.enabled])) as Record<string, boolean>,
      policy: { version: flags.policy.version, strategy: flags.policy.strategy },
    },
    me: { id: me.id, householdId: me.household_id, displayName: me.display_name, language: me.language, isCouple: me.is_couple, role: me.role, canManage: canManageWedding(me) },
    wedding: {
      id: wedding.id,
      partnerA: wedding.partner_a,
      partnerB: wedding.partner_b,
      date: wedding.wedding_date,
      city: wedding.city,
      guestCount: wedding.guest_count,
      budgetInr: me.is_couple ? wedding.budget_inr : null,
      stage: wedding.stage,
      coupleCode: me.is_couple && (ms.data ?? []).filter((m) => m.is_couple).length < 2 ? wedding.couple_code : null,
    },
    households: (hs.data ?? []).map((h) => ({
      id: h.id,
      side: h.side,
      name: h.name,
      // Each family may invite to its own side; the couple can invite to both.
      inviteCode: me.is_couple || me.household_id === h.id ? h.invite_code : null,
      members: (ms.data ?? []).filter((m) => m.household_id === h.id).map((m) => ({ id: m.id, name: m.display_name, role: m.role, isCouple: m.is_couple, isParentDelegate: m.is_parent_delegate })),
    })),
    functions: fs.data ?? [],
    priorities: (ps.data ?? [])
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
  // Private conversations and note updates do not signal activity on the shared channel.
  if (kind === "agent_note" || kind === "priority_added") return;
  if (kind === "agent_run" && !SHARED_AGENT_TRIGGERS.some((trigger) => trigger === payload.trigger)) return;
  await pingWedding(weddingId);
}

/** The couple or a parent fills in a function's details (date, start time, venue, notes). */
export async function updateFunction(
  tgUserId: number,
  input: { functionId: string; title?: string; onDate?: string | null; startsAt?: string | null; venue?: string | null; details?: string | null },
) {
  const mine = await memberships(tgUserId);
  if (!mine.length) throw new HttpError(403, "not_a_member");
  const s = db();
  const { data: fn, error: lookupError } = await s.from("functions").select("id, wedding_id")
    .eq("id", input.functionId).in("wedding_id", mine.map((m) => m.wedding_id)).maybeSingle();
  if (lookupError) throw lookupError;
  if (!fn) throw new HttpError(404, "unknown_function");
  const me = mine.find((m) => m.wedding_id === fn.wedding_id);
  if (!me || !canManageWedding(me)) throw new HttpError(403, "parents_or_couple_only");
  const date = input.onDate && /^\d{4}-\d{2}-\d{2}$/.test(input.onDate) ? input.onDate : null;
  const time = input.startsAt && /^\d{2}:\d{2}$/.test(input.startsAt) ? input.startsAt : null;
  const patch: Record<string, unknown> = { on_date: date, starts_at: time, venue: clean(input.venue ?? "", 80) || null, details: clean(input.details ?? "", 400) || null };
  if (input.title && clean(input.title, 40)) patch.title = clean(input.title, 40);
  const { error } = await s.from("functions").update(patch).eq("id", fn.id).eq("wedding_id", me.wedding_id);
  if (error) throw error;
  await logEvent(fn.wedding_id, me.id, "function_updated", { function_id: fn.id });
  return fn.wedding_id as string;
}

/** Add a function the family names itself after setup. */
export async function addFunction(tgUserId: number, weddingId: string, title: string) {
  const me = (await memberships(tgUserId)).find((m) => m.wedding_id === weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  if (!canManageWedding(me)) throw new HttpError(403, "parents_or_couple_only");
  const name = clean(title, 40);
  if (!name) throw new HttpError(400, "bad_title");
  const known = (Object.entries(FUNCTION_TITLES) as [FunctionKind, string][]).find(([, v]) => v.toLowerCase() === name.toLowerCase())?.[0];
  const { count } = await db().from("functions").select("id", { count: "exact", head: true }).eq("wedding_id", weddingId);
  const { error } = await db().from("functions").insert({ wedding_id: weddingId, kind: known ?? "other", title: name, sort: count ?? 0 });
  if (error) throw error.code === "23505" ? new HttpError(409, "exists") : error;
  await logEvent(weddingId, me.id, "function_added", { title: name });
}

export function canManageWedding(member: { is_couple: boolean; is_parent_delegate: boolean }) {
  return member.is_couple || member.is_parent_delegate;
}

export async function setParentAccess(tgUserId: number, weddingId: string, memberId: string, granted: boolean) {
  const { data, error } = await db().rpc("set_parent_access", {
    p_wedding: weddingId,
    p_telegram: tgUserId,
    p_member: memberId,
    p_granted: granted,
  });
  if (error) throw error;
  if (data === "couple_only") throw new HttpError(403, data);
  if (data === "parent_not_found") throw new HttpError(404, data);
  if (data !== "ok") throw new Error("Unexpected parent access result");
}
