/**
 * Guest side of "Coordinate guests and vendors" (issue #12): function-specific RSVPs and a
 * voluntary gift registry with private reservations. Pure and I/O-free so the rules are testable.
 * The atomic part (two guests, one last item) is enforced again in SQL; see `reserve_registry_item`
 * in supabase/migrations/20261125160000_guests_registry.sql. `reserveDecision` mirrors it.
 */

export const ATTENDANCE = ["yes", "no", "maybe"] as const;
export type Attendance = (typeof ATTENDANCE)[number];
export const MEALS = ["veg", "jain", "non_veg"] as const;
export type Meal = (typeof MEALS)[number];

export const MAX_PLATES = 20;

export interface Rsvp {
  guestId: string;
  functionId: string;
  attendance: Attendance;
  /** Plates for this household at this function (the guest plus their party). */
  plates: number;
  /** Return hampers requested for this function. */
  hampers: number;
  meal: Meal | null;
  needsAccessibility: boolean;
}

// ---------------------------------------------------------------- totals

export interface FunctionTotals {
  functionId: string;
  /** Households that said yes / maybe / no. */
  yes: number;
  maybe: number;
  no: number;
  /** Plates and hampers only count households that said yes. */
  plates: number;
  hampers: number;
  /** Plates by meal; RSVPs that name no meal count as "unspecified". */
  meals: Record<Meal | "unspecified", number>;
  accessibility: number;
}

const emptyTotals = (functionId: string): FunctionTotals => ({
  functionId, yes: 0, maybe: 0, no: 0, plates: 0, hampers: 0,
  meals: { veg: 0, jain: 0, non_veg: 0, unspecified: 0 }, accessibility: 0,
});

/**
 * Attendance and meal counts, per function. An RSVP only ever touches its own function's totals.
 * Every function in `functionIds` appears, even with no RSVPs yet.
 */
export function rsvpTotals(rsvps: Rsvp[], functionIds: string[]): Record<string, FunctionTotals> {
  const out: Record<string, FunctionTotals> = {};
  for (const id of functionIds) out[id] = emptyTotals(id);
  for (const r of rsvps) {
    const t = out[r.functionId];
    if (!t) continue; // an RSVP for a function that no longer exists counts nowhere
    t[r.attendance] += 1;
    if (r.attendance !== "yes") continue;
    t.plates += r.plates;
    t.hampers += r.hampers;
    t.meals[r.meal ?? "unspecified"] += r.plates;
    if (r.needsAccessibility) t.accessibility += 1;
  }
  return out;
}

// ---------------------------------------------------------------- registry

export interface RegistryItem {
  id: string;
  title: string;
  /** How many of this item the family would like. */
  quantity: number;
}
export interface Reservation {
  itemId: string;
  guestId: string;
}

export const remainingOf = (item: RegistryItem, reservations: Reservation[]): number =>
  Math.max(0, item.quantity - reservations.filter((r) => r.itemId === item.id).length);

/**
 * What reserving would do. Mirrors the SQL function, which takes a row lock first so that two
 * guests asking for the last item at the same moment cannot both get it.
 */
export function reserveDecision(item: RegistryItem, reservations: Reservation[], guestId: string): "ok" | "already" | "sold_out" {
  if (reservations.some((r) => r.itemId === item.id && r.guestId === guestId)) return "already";
  return remainingOf(item, reservations) > 0 ? "ok" : "sold_out";
}

// ---------------------------------------------------------------- views

export interface GuestViewInput {
  /** The guest asking. */
  guest: { id: string; name: string; familyName: string; language: string };
  wedding: { partnerA: string; partnerB: string; date: string | null; city: string | null };
  functions: { id: string; title: string; onDate: string | null; startsAt: string | null; venue: string | null; details: string | null }[];
  /** All RSVPs in the wedding; the view keeps only this guest's. */
  rsvps: Rsvp[];
  registry: RegistryItem[];
  /** All reservations; the view keeps only the count per item and this guest's own. */
  reservations: Reservation[];
}

export interface GuestView {
  guest: { name: string; familyName: string; language: string };
  wedding: { partnerA: string; partnerB: string; date: string | null; city: string | null };
  functions: { id: string; title: string; onDate: string | null; startsAt: string | null; venue: string | null; details: string | null; rsvp: { attendance: Attendance; plates: number; hampers: number; meal: Meal | null; needsAccessibility: boolean } | null }[];
  registry: { id: string; title: string; remaining: number; mine: boolean }[];
}

/**
 * What a guest may see. Built field by field from an allowlist, so extra data handed in (budget,
 * household-private priorities, other guests, who reserved what) can never leak through.
 * Reservations are private: a guest learns only whether an item is still available and what
 * they reserved themselves.
 */
export function buildGuestView(input: GuestViewInput): GuestView {
  const mine = input.rsvps.filter((r) => r.guestId === input.guest.id);
  return {
    guest: { name: input.guest.name, familyName: input.guest.familyName, language: input.guest.language },
    wedding: { partnerA: input.wedding.partnerA, partnerB: input.wedding.partnerB, date: input.wedding.date, city: input.wedding.city },
    functions: input.functions.map((f) => {
      const r = mine.find((x) => x.functionId === f.id);
      return {
        id: f.id, title: f.title, onDate: f.onDate, startsAt: f.startsAt, venue: f.venue, details: f.details,
        rsvp: r ? { attendance: r.attendance, plates: r.plates, hampers: r.hampers, meal: r.meal, needsAccessibility: r.needsAccessibility } : null,
      };
    }),
    registry: input.registry.map((item) => ({
      id: item.id,
      title: item.title,
      remaining: remainingOf(item, input.reservations),
      mine: input.reservations.some((x) => x.itemId === item.id && x.guestId === input.guest.id),
    })),
  };
}

export interface FamilySummaryInput {
  functions: { id: string; title: string }[];
  guests: { id: string; name: string; householdSide: "A" | "B" }[];
  rsvps: Rsvp[];
  registry: RegistryItem[];
  reservations: Reservation[];
}

/** The family's side: totals per function, who answered what, and who reserved which gift. */
export function buildFamilySummary(input: FamilySummaryInput) {
  const nameOf = (id: string) => input.guests.find((g) => g.id === id)?.name ?? "";
  return {
    totals: rsvpTotals(input.rsvps, input.functions.map((f) => f.id)),
    guests: input.guests.map((g) => ({
      id: g.id,
      name: g.name,
      householdSide: g.householdSide,
      answered: input.functions.filter((f) => input.rsvps.some((r) => r.guestId === g.id && r.functionId === f.id)).length,
    })),
    registry: input.registry.map((item) => ({
      id: item.id,
      title: item.title,
      quantity: item.quantity,
      remaining: remainingOf(item, input.reservations),
      reservedBy: input.reservations.filter((r) => r.itemId === item.id).map((r) => nameOf(r.guestId)),
    })),
  };
}

// ---------------------------------------------------------------- request validation

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export interface RsvpInput {
  code: string;
  functionId: string;
  attendance: Attendance;
  plates: number;
  hampers: number;
  meal: Meal | null;
  needsAccessibility: boolean;
}

export function parseRsvpInput(body: unknown): Parsed<RsvpInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "bad_body" };
  const b = body as Record<string, unknown>;
  if (typeof b.code !== "string" || !b.code.trim() || b.code.length > 64) return { ok: false, error: "bad_code" };
  if (typeof b.functionId !== "string" || !b.functionId.trim() || b.functionId.length > 64) return { ok: false, error: "bad_function" };
  if (typeof b.attendance !== "string" || !ATTENDANCE.includes(b.attendance as Attendance)) return { ok: false, error: "bad_attendance" };
  const attendance = b.attendance as Attendance;
  // Only a "yes" carries plates, hampers and a meal; "no" and "maybe" are stored as zero.
  const yes = attendance === "yes";
  const plates = b.plates === undefined ? (yes ? 1 : 0) : b.plates;
  const hampers = b.hampers === undefined ? 0 : b.hampers;
  if (!isInt(plates, yes ? 1 : 0, MAX_PLATES)) return { ok: false, error: "bad_plates" };
  if (!isInt(hampers, 0, MAX_PLATES)) return { ok: false, error: "bad_hampers" };
  if (b.meal !== undefined && b.meal !== null && !MEALS.includes(b.meal as Meal)) return { ok: false, error: "bad_meal" };
  if (b.needsAccessibility !== undefined && typeof b.needsAccessibility !== "boolean") return { ok: false, error: "bad_accessibility" };
  return {
    ok: true,
    value: {
      code: b.code.trim(),
      functionId: b.functionId.trim(),
      attendance,
      plates: yes ? plates : 0,
      hampers: yes ? hampers : 0,
      meal: yes ? ((b.meal as Meal | null | undefined) ?? null) : null,
      needsAccessibility: yes ? !!b.needsAccessibility : false,
    },
  };
}

export function parseReserveInput(body: unknown): Parsed<{ code: string; itemId: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "bad_body" };
  const b = body as Record<string, unknown>;
  if (typeof b.code !== "string" || !b.code.trim() || b.code.length > 64) return { ok: false, error: "bad_code" };
  if (typeof b.itemId !== "string" || !b.itemId.trim() || b.itemId.length > 64) return { ok: false, error: "bad_item" };
  return { ok: true, value: { code: b.code.trim(), itemId: b.itemId.trim() } };
}
