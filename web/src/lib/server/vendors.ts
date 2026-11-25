import "server-only";
import { db } from "./supabase";
import { requireStageOpen } from "./stage-gate";
import { HttpError, logEvent, memberships } from "./weddings";
import {
  budgetSummary, buildVendorView,
  type ApproveItemInput, type Booking, type BookingInput, type BookingItem, type BookingStatus,
  type DayOfContact, type FunctionInfo, type Vendor, type VendorCategory, type VendorInput,
} from "@/lib/vendors";

/** Vendors and the run sheet open only once the wedding reaches `day_of` AND `stage_day_of` is on. */
const requireDayOf = (weddingId: string, stage: string) => requireStageOpen(weddingId, stage, "day_of");

const toVendor = (r: { id: string; name: string; category: string; is_family_own: boolean; status: string; source: string }): Vendor => ({
  id: r.id, name: r.name, category: r.category as VendorCategory, isFamilyOwn: r.is_family_own, status: r.status as Vendor["status"], source: r.source as Vendor["source"],
});
const toBooking = (r: { id: string; vendor_id: string; title: string; total_inr: number | null; status: string }): Booking => ({
  id: r.id, vendorId: r.vendor_id, title: r.title, totalInr: r.total_inr === null ? null : Number(r.total_inr), status: r.status as BookingStatus,
});
const toItem = (r: { booking_id: string; function_id: string; brief: string; arrival_time: string | null; approved: boolean }): BookingItem => ({
  bookingId: r.booking_id, functionId: r.function_id, brief: r.brief, arrivalTime: r.arrival_time ? r.arrival_time.slice(0, 5) : null, approved: r.approved,
});
const toFunction = (f: { id: string; title: string; on_date: string | null; starts_at: string | null; venue: string | null }): FunctionInfo => ({
  id: f.id, title: f.title, onDate: f.on_date, startsAt: f.starts_at, venue: f.venue,
});

// ------------------------------------------------------------------ the vendor's side (by access code)

/**
 * A vendor's run sheet. Only THIS vendor's rows are loaded in the first place (their bookings and
 * those bookings' items), and buildVendorView then keeps just the approved items of confirmed
 * bookings, so nothing about other vendors, prices or the family's budget is ever in memory here.
 */
export async function vendorPage(code: string) {
  const s = db();
  const { data: row, error } = await s
    .from("vendors")
    .select("id, wedding_id, name, category, is_family_own, status, source, wedding:weddings(stage)")
    .eq("access_code", code)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new HttpError(404, "vendor_not_found");
  await requireDayOf(row.wedding_id, (row.wedding as unknown as { stage: string }).stage);

  const { data: bs, error: bErr } = await s.from("vendor_bookings").select("id, vendor_id, title, total_inr, status").eq("vendor_id", row.id);
  if (bErr) throw bErr;
  const ids = (bs ?? []).map((b) => b.id);
  const [items, fns, contact] = await Promise.all([
    ids.length ? s.from("booking_items").select("booking_id, function_id, brief, arrival_time, approved").in("booking_id", ids) : Promise.resolve({ data: [], error: null }),
    s.from("functions").select("id, title, on_date, starts_at, venue").eq("wedding_id", row.wedding_id),
    s.from("wedding_contacts").select("name, phone").eq("wedding_id", row.wedding_id).maybeSingle(),
  ]);
  for (const r of [items, fns, contact]) if (r.error) throw r.error;
  return buildVendorView({
    vendorId: row.id,
    vendors: [toVendor(row)],
    bookings: (bs ?? []).map(toBooking),
    items: (items.data ?? []).map(toItem),
    functions: (fns.data ?? []).map(toFunction),
    contact: (contact.data as DayOfContact | null) ?? null,
  });
}

// ------------------------------------------------------------------ the family's side (Telegram members)

async function requireMember(tgUserId: number, weddingId?: string) {
  const me = (await memberships(tgUserId)).find((m) => !weddingId || m.wedding_id === weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  const { data: w, error } = await db().from("weddings").select("stage").eq("id", me.wedding_id).single();
  if (error) throw error;
  await requireDayOf(me.wedding_id, w.stage);
  return me;
}

async function requireCouple(tgUserId: number, weddingId?: string) {
  const me = await requireMember(tgUserId, weddingId);
  if (!me.is_couple) throw new HttpError(403, "couple_only");
  return me;
}

/**
 * The family's view of vendors. Everyone in the family sees who the vendors are, what each booking
 * covers and what has been shared with them. Prices and the budget are the couple's: for anyone else
 * they are left out entirely, not just hidden in the screen.
 */
export async function familyVendors(tgUserId: number, weddingId?: string) {
  const me = await requireMember(tgUserId, weddingId);
  const s = db();
  const [vs, bs, fns, contact] = await Promise.all([
    s.from("vendors").select("id, name, category, is_family_own, status, source, access_code").eq("wedding_id", me.wedding_id).order("created_at"),
    s.from("vendor_bookings").select("id, vendor_id, title, total_inr, status").eq("wedding_id", me.wedding_id).order("created_at"),
    s.from("functions").select("id, title, on_date, starts_at, venue").eq("wedding_id", me.wedding_id).order("sort"),
    s.from("wedding_contacts").select("name, phone").eq("wedding_id", me.wedding_id).maybeSingle(),
  ]);
  for (const r of [vs, bs, fns, contact]) if (r.error) throw r.error;
  const ids = (bs.data ?? []).map((b) => b.id);
  const items = ids.length ? await s.from("booking_items").select("booking_id, function_id, brief, arrival_time, approved").in("booking_id", ids) : { data: [], error: null };
  if (items.error) throw items.error;

  const vendors = (vs.data ?? []).map(toVendor);
  const bookings = (bs.data ?? []).map(toBooking);
  const bookingItems = (items.data ?? []).map(toItem);
  const codes = new Map((vs.data ?? []).map((v) => [v.id as string, v.access_code as string]));
  return {
    isCouple: !!me.is_couple,
    contact: (contact.data as DayOfContact | null) ?? null,
    functions: (fns.data ?? []).map(toFunction),
    vendors: vendors.map((v) => ({
      ...v,
      // Only the couple can send a vendor their link.
      accessCode: me.is_couple ? codes.get(v.id) ?? null : null,
      bookings: bookings
        .filter((b) => b.vendorId === v.id)
        .map((b) => ({
          id: b.id,
          title: b.title,
          status: b.status,
          totalInr: me.is_couple ? b.totalInr : null,
          items: bookingItems.filter((i) => i.bookingId === b.id).map((i) => ({ functionId: i.functionId, brief: i.brief, arrivalTime: i.arrivalTime, approved: i.approved })),
        })),
    })),
    budget: me.is_couple ? budgetSummary(vendors, bookings, bookingItems) : null,
  };
}

export async function addVendor(tgUserId: number, input: VendorInput) {
  const me = await requireCouple(tgUserId, input.weddingId);
  const { data, error } = await db()
    .from("vendors")
    .insert({ wedding_id: me.wedding_id, name: input.name, category: input.category, is_family_own: input.isFamilyOwn, created_by: me.id })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent(me.wedding_id, me.id, "vendor_added", { vendor: data.id });
  return { weddingId: me.wedding_id, vendorId: data.id as string };
}

/** One booking, however many functions it covers. Its items start unapproved: nothing is shared yet. */
export async function addBooking(tgUserId: number, input: BookingInput) {
  const me = await requireCouple(tgUserId, input.weddingId);
  const s = db();
  const { data: v, error: vErr } = await s.from("vendors").select("id, status").eq("id", input.vendorId).eq("wedding_id", me.wedding_id).maybeSingle();
  if (vErr) throw vErr;
  if (!v) throw new HttpError(404, "vendor_not_found");
  if (v.status !== "active") throw new HttpError(409, "vendor_cancelled");
  const { data: fns, error: fErr } = await s.from("functions").select("id").eq("wedding_id", me.wedding_id).in("id", input.functionIds);
  if (fErr) throw fErr;
  if ((fns ?? []).length !== input.functionIds.length) throw new HttpError(404, "function_not_found");

  const { data: b, error } = await s
    .from("vendor_bookings")
    .insert({ wedding_id: me.wedding_id, vendor_id: input.vendorId, title: input.title, total_inr: input.totalInr, status: input.status })
    .select("id")
    .single();
  if (error) throw error;
  const { error: iErr } = await s.from("booking_items").insert(input.functionIds.map((function_id) => ({ booking_id: b.id, function_id })));
  if (iErr) {
    await s.from("vendor_bookings").delete().eq("id", b.id); // do not leave a booking with no items behind
    throw iErr;
  }
  await logEvent(me.wedding_id, me.id, "vendor_booking_added", { booking: b.id, functions: input.functionIds.length });
  return { weddingId: me.wedding_id, bookingId: b.id as string };
}

/** The family chooses what a vendor may see. Approving shares that item; un-approving hides it again. */
export async function setItemApproved(tgUserId: number, input: ApproveItemInput) {
  const me = await requireCouple(tgUserId, input.weddingId);
  const s = db();
  const { data: b, error: bErr } = await s.from("vendor_bookings").select("id, status").eq("id", input.bookingId).eq("wedding_id", me.wedding_id).maybeSingle();
  if (bErr) throw bErr;
  if (!b) throw new HttpError(404, "booking_not_found");
  if (b.status === "cancelled") throw new HttpError(409, "booking_cancelled");

  const patch: Record<string, unknown> = {
    approved: input.approved,
    approved_by: input.approved ? me.id : null,
    approved_at: input.approved ? new Date().toISOString() : null,
  };
  if (input.brief !== undefined) patch.brief = input.brief;
  if (input.arrivalTime !== undefined) patch.arrival_time = input.arrivalTime;
  const { data, error } = await s.from("booking_items").update(patch).eq("booking_id", input.bookingId).eq("function_id", input.functionId).select("function_id");
  if (error) throw error;
  if (!data?.length) throw new HttpError(404, "item_not_found");
  await logEvent(me.wedding_id, me.id, input.approved ? "vendor_item_shared" : "vendor_item_hidden", { booking: input.bookingId, function: input.functionId });
  return me.wedding_id;
}

/** Couple-only: load labelled sample vendors (marked source='seed'). Safe to press twice. */
export async function seedDemoVendors(tgUserId: number, weddingId?: string) {
  const me = await requireCouple(tgUserId, weddingId);
  const { error } = await db().rpc("seed_demo_vendors", { p_wedding: me.wedding_id });
  if (error) throw error;
  await logEvent(me.wedding_id, me.id, "demo_vendors_seeded", {});
  return me.wedding_id;
}
