import "server-only";
import { db } from "./supabase";
import { requireStageOpen } from "./stage-gate";
import { HttpError, logEvent, memberships } from "./weddings";
import {
  buildFamilySummary, buildGuestView,
  type Attendance, type Meal, type Reservation, type RegistryItem, type Rsvp, type RsvpInput,
} from "@/lib/guests";

/** Guests and the registry open only once the wedding reaches `guests` AND `stage_guests` is on. */
const requireGuestsStage = (weddingId: string, stage: string) => requireStageOpen(weddingId, stage, "guests");

// ------------------------------------------------------------------ the guest's side (by access code)

async function guestByCode(code: string) {
  const { data, error } = await db()
    .from("guests")
    .select("id, wedding_id, name, language, household:households(name), wedding:weddings(partner_a, partner_b, wedding_date, city, stage)")
    .eq("access_code", code)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "guest_not_found");
  const w = data.wedding as unknown as { partner_a: string; partner_b: string; wedding_date: string | null; city: string | null; stage: string };
  const h = data.household as unknown as { name: string };
  await requireGuestsStage(data.wedding_id, w.stage);
  return { id: data.id as string, weddingId: data.wedding_id as string, name: data.name as string, language: (data.language as string) || "en", familyName: h.name, wedding: w };
}

const toRsvp = (r: { guest_id: string; function_id: string; attendance: string; plates: number; hampers: number; meal: string | null; needs_accessibility: boolean }): Rsvp => ({
  guestId: r.guest_id,
  functionId: r.function_id,
  attendance: r.attendance as Attendance,
  plates: r.plates,
  hampers: r.hampers,
  meal: (r.meal as Meal | null) ?? null,
  needsAccessibility: r.needs_accessibility,
});

/** Everything a guest may see. Only this guest's own RSVPs are even loaded; see buildGuestView. */
export async function guestPage(code: string) {
  const g = await guestByCode(code);
  const s = db();
  const [fs, rs, items] = await Promise.all([
    s.from("functions").select("id, title, on_date, starts_at, venue, details, sort").eq("wedding_id", g.weddingId).order("sort"),
    s.from("guest_rsvps").select("guest_id, function_id, attendance, plates, hampers, meal, needs_accessibility").eq("guest_id", g.id),
    s.from("registry_items").select("id, title, quantity").eq("wedding_id", g.weddingId).order("created_at"),
  ]);
  for (const r of [fs, rs, items]) if (r.error) throw r.error;
  const ids = (items.data ?? []).map((i) => i.id);
  const reservations: Reservation[] = [];
  if (ids.length) {
    const { data, error } = await s.from("registry_reservations").select("item_id, guest_id").in("item_id", ids);
    if (error) throw error;
    reservations.push(...(data ?? []).map((r) => ({ itemId: r.item_id as string, guestId: r.guest_id as string })));
  }
  return buildGuestView({
    guest: { id: g.id, name: g.name, familyName: g.familyName, language: g.language },
    wedding: { partnerA: g.wedding.partner_a, partnerB: g.wedding.partner_b, date: g.wedding.wedding_date, city: g.wedding.city },
    functions: (fs.data ?? []).map((f) => ({ id: f.id, title: f.title, onDate: f.on_date, startsAt: f.starts_at, venue: f.venue, details: f.details })),
    rsvps: (rs.data ?? []).map(toRsvp),
    registry: (items.data ?? []) as RegistryItem[],
    reservations,
  });
}

/** Saves one guest's RSVP for one function. Counts for other functions are untouched. */
export async function saveRsvp(input: RsvpInput) {
  const g = await guestByCode(input.code);
  const s = db();
  const { data: fn, error: fErr } = await s.from("functions").select("id").eq("id", input.functionId).eq("wedding_id", g.weddingId).maybeSingle();
  if (fErr) throw fErr;
  if (!fn) throw new HttpError(404, "function_not_found");
  const { error } = await s.from("guest_rsvps").upsert(
    {
      wedding_id: g.weddingId,
      guest_id: g.id,
      function_id: input.functionId,
      attendance: input.attendance,
      plates: input.plates,
      hampers: input.hampers,
      meal: input.meal,
      needs_accessibility: input.needsAccessibility,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "guest_id,function_id" },
  );
  if (error) throw error;
  await logEvent(g.weddingId, null, "guest_rsvp", { guest: g.id, function: input.functionId, attendance: input.attendance, plates: input.plates });
}

export type ReserveOutcome = "ok" | "already" | "sold_out";

/** Reserves one unit. The database function locks the item, so the last unit can only go to one guest. */
export async function reserveItem(code: string, itemId: string): Promise<ReserveOutcome> {
  const g = await guestByCode(code);
  const { data, error } = await db().rpc("reserve_registry_item", { p_item: itemId, p_guest: g.id });
  if (error) throw error;
  const status = (data as { status: string }).status;
  if (status === "not_found") throw new HttpError(404, "item_not_found");
  if (status === "ok") await logEvent(g.weddingId, null, "registry_reserved", { guest: g.id, item: itemId });
  return status as ReserveOutcome;
}

/**
 * Gives a reservation back so someone else can take it. Only this guest's own reservation is
 * touched. No race to guard: releasing only ever increases what is available.
 */
export async function releaseItem(code: string, itemId: string): Promise<void> {
  const g = await guestByCode(code);
  const { error } = await db().from("registry_reservations").delete().eq("item_id", itemId).eq("guest_id", g.id);
  if (error) throw error;
  await logEvent(g.weddingId, null, "registry_released", { guest: g.id, item: itemId });
}

// ------------------------------------------------------------------ the family's side (Telegram members)

async function requireMember(tgUserId: number, weddingId?: string) {
  const me = (await memberships(tgUserId)).find((m) => !weddingId || m.wedding_id === weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  const { data: w, error } = await db().from("weddings").select("stage").eq("id", me.wedding_id).single();
  if (error) throw error;
  await requireGuestsStage(me.wedding_id, w.stage);
  return me;
}

/** The family sees totals per function, who answered, and who reserved which gift. */
export async function familyGuestSummary(tgUserId: number, weddingId?: string) {
  const me = await requireMember(tgUserId, weddingId);
  const s = db();
  const [fs, gs, rs, items, hs] = await Promise.all([
    s.from("functions").select("id, title").eq("wedding_id", me.wedding_id).order("sort"),
    s.from("guests").select("id, name, household_id, access_code").eq("wedding_id", me.wedding_id).order("created_at"),
    s.from("guest_rsvps").select("guest_id, function_id, attendance, plates, hampers, meal, needs_accessibility").eq("wedding_id", me.wedding_id),
    s.from("registry_items").select("id, title, quantity").eq("wedding_id", me.wedding_id).order("created_at"),
    s.from("households").select("id, side").eq("wedding_id", me.wedding_id),
  ]);
  for (const r of [fs, gs, rs, items, hs]) if (r.error) throw r.error;
  const ids = (items.data ?? []).map((i) => i.id);
  let reservations: Reservation[] = [];
  if (ids.length) {
    const { data, error } = await s.from("registry_reservations").select("item_id, guest_id").in("item_id", ids);
    if (error) throw error;
    reservations = (data ?? []).map((r) => ({ itemId: r.item_id as string, guestId: r.guest_id as string }));
  }
  const side = (id: string) => ((hs.data ?? []).find((h) => h.id === id)?.side ?? "A") as "A" | "B";
  const summary = buildFamilySummary({
    functions: fs.data ?? [],
    guests: (gs.data ?? []).map((g) => ({ id: g.id, name: g.name, householdSide: side(g.household_id) })),
    rsvps: (rs.data ?? []).map(toRsvp),
    registry: (items.data ?? []) as RegistryItem[],
    reservations,
  });
  // A family sees the access link only for guests its own household invited.
  const codes = new Map((gs.data ?? []).filter((g) => g.household_id === me.household_id || me.is_couple).map((g) => [g.id, g.access_code as string]));
  return { ...summary, guests: summary.guests.map((g) => ({ ...g, accessCode: codes.get(g.id) ?? null })), functions: fs.data ?? [] };
}

export async function addGuest(tgUserId: number, input: { weddingId?: string; name: string; side?: "A" | "B" }) {
  const me = await requireMember(tgUserId, input.weddingId);
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new HttpError(400, "bad_name");
  let householdId = me.household_id as string | null;
  // The couple has no household of their own and may add guests for either family.
  if (me.is_couple && input.side) {
    const { data, error } = await db().from("households").select("id").eq("wedding_id", me.wedding_id).eq("side", input.side).maybeSingle();
    if (error) throw error;
    householdId = data?.id ?? householdId;
  }
  if (!householdId) throw new HttpError(400, "no_household");
  const { data, error } = await db().from("guests").insert({ wedding_id: me.wedding_id, household_id: householdId, name, language: me.language, added_by: me.id }).select("id, access_code").single();
  if (error) throw error;
  await logEvent(me.wedding_id, me.id, "guest_added", { guest: data.id });
  return { weddingId: me.wedding_id, guestId: data.id as string, accessCode: data.access_code as string };
}

/** The registry is the couple's choice, and voluntary: nothing requires a guest to use it. */
export async function addRegistryItem(tgUserId: number, input: { weddingId?: string; title: string; quantity: number }) {
  const me = await requireMember(tgUserId, input.weddingId);
  if (!me.is_couple) throw new HttpError(403, "couple_only");
  const title = input.title.trim().slice(0, 120);
  if (!title) throw new HttpError(400, "bad_title");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) throw new HttpError(400, "bad_quantity");
  const { error } = await db().from("registry_items").insert({ wedding_id: me.wedding_id, title, quantity: input.quantity, created_by: me.id });
  if (error) throw error;
  await logEvent(me.wedding_id, me.id, "registry_item_added", { title });
  return me.wedding_id;
}
