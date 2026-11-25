import { describe, expect, it } from "vitest";
import {
  buildFamilySummary, buildGuestView, parseReserveInput, parseRsvpInput, remainingOf, reserveDecision, rsvpTotals,
  type GuestViewInput, type Rsvp,
} from "./guests";

const rsvp = (o: Partial<Rsvp> & Pick<Rsvp, "guestId" | "functionId">): Rsvp => ({
  attendance: "yes", plates: 1, hampers: 0, meal: null, needsAccessibility: false, ...o,
});

describe("rsvpTotals: per-function attendance and meal counts", () => {
  it("a household RSVP adds four plates and one return hamper", () => {
    const t = rsvpTotals([rsvp({ guestId: "g1", functionId: "sangeet", plates: 4, hampers: 1, meal: "veg" })], ["sangeet"]);
    expect(t.sangeet).toMatchObject({ yes: 1, plates: 4, hampers: 1, meals: { veg: 4, jain: 0, non_veg: 0, unspecified: 0 } });
  });

  it("an RSVP changes only its own function's totals", () => {
    const before = rsvpTotals([rsvp({ guestId: "g1", functionId: "sangeet", plates: 3 })], ["sangeet", "reception"]);
    const after = rsvpTotals([rsvp({ guestId: "g1", functionId: "sangeet", plates: 3 }), rsvp({ guestId: "g1", functionId: "reception", plates: 2, hampers: 1 })], ["sangeet", "reception"]);
    expect(after.sangeet).toEqual(before.sangeet);
    expect(after.reception).toMatchObject({ yes: 1, plates: 2, hampers: 1 });
    expect(before.reception.plates).toBe(0);
  });

  it("only 'yes' counts plates, hampers and meals; maybe and no are counted as answers only", () => {
    const t = rsvpTotals(
      [
        rsvp({ guestId: "a", functionId: "f", plates: 2, meal: "jain", needsAccessibility: true }),
        rsvp({ guestId: "b", functionId: "f", attendance: "maybe", plates: 5, hampers: 2 }),
        rsvp({ guestId: "c", functionId: "f", attendance: "no", plates: 9, hampers: 9, meal: "veg" }),
      ],
      ["f"],
    ).f;
    expect(t).toMatchObject({ yes: 1, maybe: 1, no: 1, plates: 2, hampers: 0, accessibility: 1 });
    expect(t.meals).toEqual({ veg: 0, jain: 2, non_veg: 0, unspecified: 0 });
  });

  it("splits plates by meal and counts a missing meal as unspecified", () => {
    const t = rsvpTotals([rsvp({ guestId: "a", functionId: "f", plates: 2, meal: "veg" }), rsvp({ guestId: "b", functionId: "f", plates: 3, meal: "non_veg" }), rsvp({ guestId: "c", functionId: "f", plates: 1 })], ["f"]).f;
    expect(t.meals).toEqual({ veg: 2, jain: 0, non_veg: 3, unspecified: 1 });
    expect(t.plates).toBe(6);
  });

  it("lists every function even with no RSVPs, and ignores RSVPs for unknown functions", () => {
    const t = rsvpTotals([rsvp({ guestId: "a", functionId: "gone", plates: 4 })], ["f1", "f2"]);
    expect(Object.keys(t).sort()).toEqual(["f1", "f2"]);
    expect(t.f1.plates + t.f2.plates).toBe(0);
  });
});

describe("registry reservations", () => {
  const item = { id: "i1", title: "Brass lamp", quantity: 1 };

  it("the last item goes to the first guest; the second gets sold_out", () => {
    expect(reserveDecision(item, [], "g1")).toBe("ok");
    expect(reserveDecision(item, [{ itemId: "i1", guestId: "g1" }], "g2")).toBe("sold_out");
  });

  it("reserving the same item twice is a no-op for that guest", () => {
    expect(reserveDecision({ ...item, quantity: 3 }, [{ itemId: "i1", guestId: "g1" }], "g1")).toBe("already");
  });

  it("an item with several units stays available until the last is taken", () => {
    const three = { ...item, quantity: 3 };
    const taken = [{ itemId: "i1", guestId: "a" }, { itemId: "i1", guestId: "b" }];
    expect(remainingOf(three, taken)).toBe(1);
    expect(reserveDecision(three, taken, "c")).toBe("ok");
    expect(reserveDecision(three, [...taken, { itemId: "i1", guestId: "c" }], "d")).toBe("sold_out");
  });

  it("other items' reservations do not use up this item", () => {
    expect(remainingOf(item, [{ itemId: "other", guestId: "g1" }])).toBe(1);
  });
});

describe("guest view: private data never reaches a guest", () => {
  // Hand the builder far more than a guest may see, as a careless caller could.
  const secret = {
    budgetInr: 1_500_000,
    privateNote: "Aai: keep the budget under 12 lakh, don't tell the Deshmukhs",
    otherGuest: "Zoya Khan",
  };
  const input = {
    guest: { id: "g1", name: "Priya", familyName: "Patil family", language: "mr" },
    wedding: { partnerA: "Meera", partnerB: "Aarav", date: "2027-02-14", city: "Pune", budgetInr: secret.budgetInr, guestCount: 350 },
    functions: [{ id: "f1", title: "Sangeet", onDate: "2027-02-13", startsAt: "19:00", venue: "Hall A", details: "Dress: festive", privatePriority: secret.privateNote }],
    rsvps: [
      rsvp({ guestId: "g1", functionId: "f1", plates: 4, hampers: 1, meal: "veg" }),
      rsvp({ guestId: "g2", functionId: "f1", plates: 7, meal: "jain" }),
    ],
    registry: [{ id: "i1", title: "Brass lamp", quantity: 2 }, { id: "i2", title: "Silver tray", quantity: 1 }],
    reservations: [{ itemId: "i1", guestId: "g2" }, { itemId: "i2", guestId: "g1" }],
    priorities: [{ kind: "note", note: secret.privateNote, visibility: "household" }],
    otherGuests: [{ id: "g2", name: secret.otherGuest }],
  } as unknown as GuestViewInput;

  const view = buildGuestView(input);
  const text = JSON.stringify(view);

  it("contains no budget, guest count, private priority or other guest", () => {
    expect(text).not.toContain(String(secret.budgetInr));
    expect(text).not.toContain("12 lakh");
    expect(text).not.toContain(secret.otherGuest);
    expect(text).not.toContain("budgetInr");
    expect(text).not.toContain("guestCount");
    expect(text).not.toContain("priorit");
  });

  it("carries the guest's own language so the page can open in it", () => {
    expect(view.guest).toEqual({ name: "Priya", familyName: "Patil family", language: "mr" });
  });

  it("shows only this guest's own RSVP, not another household's", () => {
    expect(view.functions[0].rsvp).toEqual({ attendance: "yes", plates: 4, hampers: 1, meal: "veg", needsAccessibility: false });
    expect(text).not.toContain("jain");
  });

  it("gift reservations are private: others' reservations show only as less remaining, mine as mine", () => {
    expect(view.registry).toEqual([
      { id: "i1", title: "Brass lamp", remaining: 1, mine: false },
      { id: "i2", title: "Silver tray", remaining: 0, mine: true },
    ]);
    expect(text).not.toContain("g2");
  });
});

describe("family summary", () => {
  it("shows the family who reserved what, plus per-function totals", () => {
    const s = buildFamilySummary({
      functions: [{ id: "f1", title: "Sangeet" }],
      guests: [{ id: "g1", name: "Priya", householdSide: "A" }, { id: "g2", name: "Zoya", householdSide: "B" }],
      rsvps: [rsvp({ guestId: "g1", functionId: "f1", plates: 4 })],
      registry: [{ id: "i1", title: "Brass lamp", quantity: 2 }],
      reservations: [{ itemId: "i1", guestId: "g2" }],
    });
    expect(s.totals.f1.plates).toBe(4);
    expect(s.registry[0]).toMatchObject({ remaining: 1, reservedBy: ["Zoya"] });
    expect(s.guests.find((g) => g.id === "g1")?.answered).toBe(1);
    expect(s.guests.find((g) => g.id === "g2")?.answered).toBe(0);
  });
});

describe("request validation", () => {
  const ok = { code: "abc123", functionId: "f1", attendance: "yes", plates: 4, hampers: 1, meal: "veg" };

  it("accepts a household RSVP of four plates and one hamper", () => {
    expect(parseRsvpInput(ok)).toEqual({ ok: true, value: { code: "abc123", functionId: "f1", attendance: "yes", plates: 4, hampers: 1, meal: "veg", needsAccessibility: false } });
  });

  it("a 'no' or 'maybe' stores no plates, hampers or meal, whatever was sent", () => {
    for (const attendance of ["no", "maybe"]) {
      expect(parseRsvpInput({ ...ok, attendance })).toEqual({ ok: true, value: { code: "abc123", functionId: "f1", attendance, plates: 0, hampers: 0, meal: null, needsAccessibility: false } });
    }
  });

  it("rejects bad numbers, meals and shapes", () => {
    expect(parseRsvpInput({ ...ok, plates: 0 })).toEqual({ ok: false, error: "bad_plates" });
    expect(parseRsvpInput({ ...ok, plates: 21 })).toEqual({ ok: false, error: "bad_plates" });
    expect(parseRsvpInput({ ...ok, plates: "4" })).toEqual({ ok: false, error: "bad_plates" });
    expect(parseRsvpInput({ ...ok, hampers: -1 })).toEqual({ ok: false, error: "bad_hampers" });
    expect(parseRsvpInput({ ...ok, meal: "pizza" })).toEqual({ ok: false, error: "bad_meal" });
    expect(parseRsvpInput({ ...ok, attendance: "definitely" })).toEqual({ ok: false, error: "bad_attendance" });
    expect(parseRsvpInput({ ...ok, code: "" })).toEqual({ ok: false, error: "bad_code" });
    expect(parseRsvpInput(null)).toEqual({ ok: false, error: "bad_body" });
  });

  it("reserve needs a code and an item", () => {
    expect(parseReserveInput({ code: "c", itemId: "i" })).toEqual({ ok: true, value: { code: "c", itemId: "i" } });
    expect(parseReserveInput({ code: "c" })).toEqual({ ok: false, error: "bad_item" });
    expect(parseReserveInput([])).toEqual({ ok: false, error: "bad_body" });
  });
});
