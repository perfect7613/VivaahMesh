/**
 * Vendors and their run sheet (issue #13, first half). Pure and I/O-free so the rules are testable:
 *  - a vendor sees ONLY the approved items of their own confirmed bookings, never prices, other
 *    vendors' terms, the family's budget or anything private;
 *  - a package that covers several functions is ONE booking and counts once in the budget.
 * The database holds the same facts (see supabase/migrations/20261125170000_vendors.sql).
 */

export const VENDOR_CATEGORIES = ["venue", "caterer", "decorator", "photographer", "videographer", "makeup", "mehendi", "musician", "choreographer", "other"] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export type VendorStatus = "active" | "cancelled";
export type BookingStatus = "proposed" | "confirmed" | "cancelled";
/** `seed` marks sample data so it is never mistaken for a real vendor conversation. */
export type DataSource = "app" | "seed";

export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory;
  /** A vendor the family already knows and brought themselves, rather than one the team sourced. */
  isFamilyOwn: boolean;
  status: VendorStatus;
  source: DataSource;
}

/** One agreement with a vendor. A package spanning several functions is still ONE booking. */
export interface Booking {
  id: string;
  vendorId: string;
  title: string;
  /** Confirmed total in rupees. null = "Price pending": a cost is never invented. */
  totalInr: number | null;
  status: BookingStatus;
}

/** What one function needs from the vendor, and whether the family approved sharing it. */
export interface BookingItem {
  bookingId: string;
  functionId: string;
  brief: string;
  /** "HH:MM" on the function's day. */
  arrivalTime: string | null;
  approved: boolean;
}

export interface FunctionInfo {
  id: string;
  title: string;
  onDate: string | null;
  startsAt: string | null;
  venue: string | null;
}

export interface DayOfContact {
  name: string;
  phone: string;
}

// ---------------------------------------------------------------- the vendor's view

export interface VendorViewInput {
  /** The vendor asking. */
  vendorId: string;
  /** Everything in the wedding; the view keeps only what this vendor may see. */
  vendors: Vendor[];
  bookings: Booking[];
  items: BookingItem[];
  functions: FunctionInfo[];
  contact: DayOfContact | null;
}

export interface VendorView {
  vendor: { name: string; category: VendorCategory };
  /** True when this is sample data, so the page can say so. */
  sample: boolean;
  /** The person on the ground to call. Shared with every vendor because they all need it. */
  contact: DayOfContact | null;
  items: { functionId: string; function: string; onDate: string | null; startsAt: string | null; venue: string | null; package: string; brief: string; arrivalTime: string | null }[];
}

/**
 * What a vendor may see. Built field by field from an allowlist, so extra data handed in (prices,
 * other vendors, the family's budget, unapproved items) can never leak through. A vendor sees a
 * function's item only when ALL hold: it belongs to their own booking, that booking is confirmed,
 * their vendor record is still active, and the family approved sharing it. Prices are not part of
 * a run sheet, so they are never included, not even the vendor's own.
 */
export function buildVendorView(input: VendorViewInput): VendorView | null {
  const vendor = input.vendors.find((v) => v.id === input.vendorId);
  if (!vendor) return null;
  const own = new Map(
    vendor.status === "active"
      ? input.bookings.filter((b) => b.vendorId === vendor.id && b.status === "confirmed").map((b) => [b.id, b] as const)
      : [],
  );
  const rows = input.items
    .filter((i) => i.approved && own.has(i.bookingId))
    .flatMap((i) => {
      const f = input.functions.find((x) => x.id === i.functionId);
      return f ? [{ i, f, b: own.get(i.bookingId)! }] : [];
    })
    // Chronological, so the sheet reads in the order the day happens.
    .sort((a, b) => `${a.f.onDate ?? "9999"}${a.i.arrivalTime ?? a.f.startsAt ?? "99:99"}`.localeCompare(`${b.f.onDate ?? "9999"}${b.i.arrivalTime ?? b.f.startsAt ?? "99:99"}`));
  return {
    vendor: { name: vendor.name, category: vendor.category },
    sample: vendor.source === "seed",
    contact: input.contact ? { name: input.contact.name, phone: input.contact.phone } : null,
    items: rows.map(({ i, f, b }) => ({
      functionId: f.id, function: f.title, onDate: f.onDate, startsAt: f.startsAt, venue: f.venue,
      package: b.title, brief: i.brief, arrivalTime: i.arrivalTime,
    })),
  };
}

// ---------------------------------------------------------------- budget

export interface BudgetLine {
  bookingId: string;
  vendor: string;
  isFamilyOwn: boolean;
  status: Exclude<BookingStatus, "cancelled">;
  totalInr: number | null;
  /** How many functions the package covers. Informational: it never multiplies the total. */
  functions: number;
}

export interface BudgetSummary {
  /** Proposed, not yet agreed. */
  plannedInr: number;
  /** Confirmed bookings. */
  committedInr: number;
  /** Bookings with no confirmed price yet. They add nothing to the totals. */
  pricePending: number;
  lines: BudgetLine[];
}

/**
 * Planned and committed spend. One booking is one amount, however many functions it covers: a
 * package for the Sangeet, Ceremony and Reception counts once, not three times. Cancelled bookings
 * and bookings with no price add nothing (a missing price is "pending", never zero or a guess).
 */
export function budgetSummary(vendors: Vendor[], bookings: Booking[], items: BookingItem[]): BudgetSummary {
  const lines: BudgetLine[] = [];
  const seen = new Set<string>();
  for (const b of bookings) {
    if (b.status === "cancelled" || seen.has(b.id)) continue;
    seen.add(b.id);
    const v = vendors.find((x) => x.id === b.vendorId);
    lines.push({
      bookingId: b.id,
      vendor: v?.name ?? "",
      isFamilyOwn: !!v?.isFamilyOwn,
      status: b.status,
      totalInr: b.totalInr,
      functions: new Set(items.filter((i) => i.bookingId === b.id).map((i) => i.functionId)).size,
    });
  }
  const sum = (status: BudgetLine["status"]) => lines.filter((l) => l.status === status).reduce((n, l) => n + (l.totalInr ?? 0), 0);
  return { plannedInr: sum("proposed"), committedInr: sum("confirmed"), pricePending: lines.filter((l) => l.totalInr === null).length, lines };
}

// ---------------------------------------------------------------- request validation

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const isObj = (b: unknown): b is Record<string, unknown> => !!b && typeof b === "object" && !Array.isArray(b);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface VendorInput { weddingId?: string; name: string; category: VendorCategory; isFamilyOwn: boolean }

export function parseVendorInput(body: unknown): Parsed<VendorInput> {
  if (!isObj(body)) return { ok: false, error: "bad_body" };
  if (body.weddingId !== undefined && typeof body.weddingId !== "string") return { ok: false, error: "bad_wedding" };
  const name = str(body.name, 80);
  if (!name) return { ok: false, error: "bad_name" };
  if (typeof body.category !== "string" || !VENDOR_CATEGORIES.includes(body.category as VendorCategory)) return { ok: false, error: "bad_category" };
  if (body.isFamilyOwn !== undefined && typeof body.isFamilyOwn !== "boolean") return { ok: false, error: "bad_family_own" };
  return { ok: true, value: { weddingId: body.weddingId as string | undefined, name, category: body.category as VendorCategory, isFamilyOwn: !!body.isFamilyOwn } };
}

export interface BookingInput { weddingId?: string; vendorId: string; title: string; totalInr: number | null; status: Exclude<BookingStatus, "cancelled">; functionIds: string[] }

export function parseBookingInput(body: unknown): Parsed<BookingInput> {
  if (!isObj(body)) return { ok: false, error: "bad_body" };
  if (body.weddingId !== undefined && typeof body.weddingId !== "string") return { ok: false, error: "bad_wedding" };
  if (typeof body.vendorId !== "string" || !body.vendorId.trim()) return { ok: false, error: "bad_vendor" };
  const title = str(body.title, 120);
  if (!title) return { ok: false, error: "bad_title" };
  const total = body.totalInr === undefined ? null : body.totalInr;
  if (total !== null && (typeof total !== "number" || !Number.isInteger(total) || total < 0 || total > 1_000_000_000)) return { ok: false, error: "bad_total" };
  const status = body.status === undefined ? "proposed" : body.status;
  if (status !== "proposed" && status !== "confirmed") return { ok: false, error: "bad_status" };
  if (!Array.isArray(body.functionIds) || body.functionIds.length < 1 || body.functionIds.length > 20 || body.functionIds.some((f) => typeof f !== "string" || !f)) return { ok: false, error: "bad_functions" };
  // A function listed twice is still one function: de-duplicate so a package never double-counts.
  return { ok: true, value: { weddingId: body.weddingId as string | undefined, vendorId: body.vendorId.trim(), title, totalInr: total, status, functionIds: [...new Set(body.functionIds as string[])] } };
}

export interface ApproveItemInput { weddingId?: string; bookingId: string; functionId: string; approved: boolean; brief?: string; arrivalTime?: string | null }

export function parseApproveItemInput(body: unknown): Parsed<ApproveItemInput> {
  if (!isObj(body)) return { ok: false, error: "bad_body" };
  if (body.weddingId !== undefined && typeof body.weddingId !== "string") return { ok: false, error: "bad_wedding" };
  if (typeof body.bookingId !== "string" || !body.bookingId.trim()) return { ok: false, error: "bad_booking" };
  if (typeof body.functionId !== "string" || !body.functionId.trim()) return { ok: false, error: "bad_function" };
  if (typeof body.approved !== "boolean") return { ok: false, error: "bad_approved" };
  if (body.arrivalTime !== undefined && body.arrivalTime !== null && (typeof body.arrivalTime !== "string" || !TIME.test(body.arrivalTime))) return { ok: false, error: "bad_arrival" };
  if (body.brief !== undefined && typeof body.brief !== "string") return { ok: false, error: "bad_brief" };
  return {
    ok: true,
    value: {
      weddingId: body.weddingId as string | undefined,
      bookingId: body.bookingId.trim(),
      functionId: body.functionId.trim(),
      approved: body.approved,
      brief: body.brief === undefined ? undefined : str(body.brief, 600),
      arrivalTime: body.arrivalTime as string | null | undefined,
    },
  };
}
