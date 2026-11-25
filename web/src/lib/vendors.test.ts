import { describe, expect, it } from "vitest";
import {
  budgetSummary, buildVendorView, parseApproveItemInput, parseBookingInput, parseVendorInput,
  type Booking, type BookingItem, type FunctionInfo, type Vendor, type VendorViewInput,
} from "./vendors";

const vendor = (o: Partial<Vendor> & Pick<Vendor, "id" | "name">): Vendor => ({ category: "caterer", isFamilyOwn: false, status: "active", source: "app", ...o });
const booking = (o: Partial<Booking> & Pick<Booking, "id" | "vendorId">): Booking => ({ title: "Package", totalInr: null, status: "confirmed", ...o });
const item = (o: Partial<BookingItem> & Pick<BookingItem, "bookingId" | "functionId">): BookingItem => ({ brief: "", arrivalTime: null, approved: true, ...o });

const functions: FunctionInfo[] = [
  { id: "f-sangeet", title: "Sangeet", onDate: "2027-02-13", startsAt: "19:00:00", venue: "Hall A" },
  { id: "f-ceremony", title: "Ceremony", onDate: "2027-02-14", startsAt: "10:00:00", venue: "Hall A" },
  { id: "f-reception", title: "Reception", onDate: "2027-02-14", startsAt: "19:00:00", venue: "Lawn" },
];

describe("vendor view: a vendor sees only their own approved items", () => {
  // Secrets: private budget, another vendor's price and terms, an unapproved brief, a household note.
  const secret = { budget: 1_500_000, otherPrice: 777_777, otherBrief: "Decor team: 40 marigold arches, call Sunil on 98765", unapproved: "DRAFT: ask for discount, family thinks too costly", note: "keep under 12 lakh" };
  const input = {
    vendorId: "v-cater",
    vendors: [vendor({ id: "v-cater", name: "Sharma Caterers", isFamilyOwn: true }), vendor({ id: "v-decor", name: "Bloom Decor", category: "decorator" })],
    bookings: [
      booking({ id: "b-cater", vendorId: "v-cater", title: "Dinner package", totalInr: 420_000 }),
      booking({ id: "b-decor", vendorId: "v-decor", title: "Decor package", totalInr: secret.otherPrice }),
    ],
    items: [
      item({ bookingId: "b-cater", functionId: "f-reception", brief: "Dinner for 350, live counters", arrivalTime: "16:30" }),
      item({ bookingId: "b-cater", functionId: "f-sangeet", brief: "Snacks for 350", arrivalTime: "17:30" }),
      item({ bookingId: "b-cater", functionId: "f-ceremony", brief: secret.unapproved, approved: false }),
      item({ bookingId: "b-decor", functionId: "f-sangeet", brief: secret.otherBrief, arrivalTime: "09:00" }),
    ],
    functions,
    contact: { name: "Kavita (on-ground lead)", phone: "+91 90000 11111" },
    // Extra private data a careless caller might pass along.
    budgetInr: secret.budget,
    priorities: [{ kind: "note", note: secret.note, visibility: "household" }],
  } as unknown as VendorViewInput;
  const view = buildVendorView(input)!;
  const text = JSON.stringify(view);

  it("shows the vendor their approved items in the order the day happens", () => {
    expect(view.vendor).toEqual({ name: "Sharma Caterers", category: "caterer" });
    expect(view.items.map((i) => [i.function, i.arrivalTime])).toEqual([["Sangeet", "17:30"], ["Reception", "16:30"]]);
    expect(view.items[0]).toMatchObject({ package: "Dinner package", brief: "Snacks for 350", venue: "Hall A" });
    expect(view.contact).toEqual({ name: "Kavita (on-ground lead)", phone: "+91 90000 11111" });
  });

  it("contains no prices, budget, other vendor, unapproved item or household note", () => {
    for (const secretValue of [String(secret.budget), String(secret.otherPrice), "420000", "Bloom", "marigold", "Sunil", secret.unapproved, "12 lakh"]) {
      expect(text).not.toContain(secretValue);
    }
    for (const key of ["totalInr", "price", "budget", "priorit", "vendorId", "approved"]) expect(text).not.toContain(key);
  });

  it("an unapproved item stays hidden until the family approves it", () => {
    const before = buildVendorView(input)!;
    expect(before.items.some((i) => i.function === "Ceremony")).toBe(false);
    const approved = buildVendorView({ ...input, items: input.items.map((i) => (i.functionId === "f-ceremony" ? { ...i, approved: true } : i)) })!;
    expect(approved.items.some((i) => i.function === "Ceremony")).toBe(true);
  });

  it("a proposed or cancelled booking shows nothing, and neither does a cancelled vendor", () => {
    for (const status of ["proposed", "cancelled"] as const) {
      const v = buildVendorView({ ...input, bookings: input.bookings.map((b) => (b.id === "b-cater" ? { ...b, status } : b)) })!;
      expect(v.items).toEqual([]);
    }
    const gone = buildVendorView({ ...input, vendors: input.vendors.map((v) => (v.id === "v-cater" ? { ...v, status: "cancelled" as const } : v)) })!;
    expect(gone.items).toEqual([]);
  });

  it("another vendor sees only their own items", () => {
    const decor = buildVendorView({ ...input, vendorId: "v-decor" })!;
    expect(decor.items.map((i) => i.brief)).toEqual([secret.otherBrief]);
    expect(JSON.stringify(decor)).not.toContain("Dinner");
  });

  it("an unknown vendor gets no view; sample data is labelled", () => {
    expect(buildVendorView({ ...input, vendorId: "nope" })).toBeNull();
    expect(view.sample).toBe(false);
    const seeded = buildVendorView({ ...input, vendors: input.vendors.map((v) => (v.id === "v-cater" ? { ...v, source: "seed" as const } : v)) })!;
    expect(seeded.sample).toBe(true);
  });

  it("an item for a function that no longer exists is left out", () => {
    const v = buildVendorView({ ...input, functions: functions.filter((f) => f.id !== "f-sangeet") })!;
    expect(v.items.map((i) => i.function)).toEqual(["Reception"]);
  });
});

describe("budget: a multi-function package is counted once", () => {
  const vendors = [vendor({ id: "v-photo", name: "Lens Studio", category: "photographer" }), vendor({ id: "v-cater", name: "Sharma Caterers", isFamilyOwn: true })];

  it("one package over three functions adds its price once, not three times", () => {
    const bookings = [booking({ id: "b1", vendorId: "v-photo", title: "All three functions", totalInr: 300_000 })];
    const items = ["f-sangeet", "f-ceremony", "f-reception"].map((functionId) => item({ bookingId: "b1", functionId }));
    const s = budgetSummary(vendors, bookings, items);
    expect(s.committedInr).toBe(300_000);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].functions).toBe(3); // informational only: it never multiplies the total
  });

  it("keeps planned and committed apart, and skips cancelled bookings", () => {
    const s = budgetSummary(
      vendors,
      [
        booking({ id: "b1", vendorId: "v-photo", totalInr: 300_000, status: "confirmed" }),
        booking({ id: "b2", vendorId: "v-cater", totalInr: 420_000, status: "proposed" }),
        booking({ id: "b3", vendorId: "v-cater", totalInr: 999_999, status: "cancelled" }),
      ],
      [],
    );
    expect(s).toMatchObject({ committedInr: 300_000, plannedInr: 420_000 });
    expect(s.lines.map((l) => l.bookingId)).toEqual(["b1", "b2"]);
  });

  it("a missing price is pending, never zero or a guess", () => {
    const s = budgetSummary(vendors, [booking({ id: "b1", vendorId: "v-photo", totalInr: null }), booking({ id: "b2", vendorId: "v-cater", totalInr: 50_000 })], []);
    expect(s.pricePending).toBe(1);
    expect(s.committedInr).toBe(50_000);
    expect(s.lines.find((l) => l.bookingId === "b1")?.totalInr).toBeNull();
  });

  it("a booking listed twice counts once; the family's own vendor is included", () => {
    const b = booking({ id: "b1", vendorId: "v-cater", totalInr: 100_000 });
    const s = budgetSummary(vendors, [b, b], []);
    expect(s.committedInr).toBe(100_000);
    expect(s.lines[0].isFamilyOwn).toBe(true);
  });
});

describe("request validation", () => {
  it("vendor: needs a name and a known category", () => {
    expect(parseVendorInput({ name: " Sharma Caterers ", category: "caterer", isFamilyOwn: true })).toEqual({ ok: true, value: { weddingId: undefined, name: "Sharma Caterers", category: "caterer", isFamilyOwn: true } });
    expect(parseVendorInput({ name: "", category: "caterer" })).toEqual({ ok: false, error: "bad_name" });
    expect(parseVendorInput({ name: "x", category: "dj" })).toEqual({ ok: false, error: "bad_category" });
    expect(parseVendorInput(null)).toEqual({ ok: false, error: "bad_body" });
  });

  it("booking: de-duplicates functions so a package cannot double-count, and defaults to proposed", () => {
    const r = parseBookingInput({ vendorId: "v1", title: "Package", totalInr: 300000, functionIds: ["a", "b", "a"] });
    expect(r).toEqual({ ok: true, value: { weddingId: undefined, vendorId: "v1", title: "Package", totalInr: 300000, status: "proposed", functionIds: ["a", "b"] } });
  });

  it("booking: price is optional (pending) but never negative, fractional or a string", () => {
    expect(parseBookingInput({ vendorId: "v1", title: "P", functionIds: ["a"] })).toMatchObject({ ok: true, value: { totalInr: null } });
    for (const totalInr of [-1, 1.5, "5000", 2_000_000_000]) expect(parseBookingInput({ vendorId: "v1", title: "P", totalInr, functionIds: ["a"] })).toEqual({ ok: false, error: "bad_total" });
    expect(parseBookingInput({ vendorId: "v1", title: "P", functionIds: [] })).toEqual({ ok: false, error: "bad_functions" });
    expect(parseBookingInput({ vendorId: "v1", title: "P", status: "cancelled", functionIds: ["a"] })).toEqual({ ok: false, error: "bad_status" });
  });

  it("approve item: validates the arrival time", () => {
    expect(parseApproveItemInput({ bookingId: "b", functionId: "f", approved: true, arrivalTime: "16:30", brief: "Dinner for 350" }).ok).toBe(true);
    for (const arrivalTime of ["4:30pm", "24:00", "16:60", 1630]) expect(parseApproveItemInput({ bookingId: "b", functionId: "f", approved: true, arrivalTime })).toEqual({ ok: false, error: "bad_arrival" });
    expect(parseApproveItemInput({ bookingId: "b", functionId: "f", approved: "yes" })).toEqual({ ok: false, error: "bad_approved" });
  });
});
