import { beforeEach, describe, expect, it, vi } from "vitest";
import { guestView, lifecycleAction, lifecycleView, vendorRunSheet } from "./lifecycle";

const { from, membership } = vi.hoisted(() => ({
  from: vi.fn(),
  membership: { id: "member", wedding_id: "wedding", household_id: "family-a", role: "parent", is_couple: false, is_parent_delegate: false },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("./supabase", () => ({ db: () => ({ from }) }));
vi.mock("./flags", () => ({ flagsForMember: async () => ({ source: "safe_defaults", features: {} }) }));
vi.mock("./agent", () => ({ runAgent: vi.fn() }));
vi.mock("./weddings", () => ({
  HttpError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
  memberships: async () => [membership],
  canManageWedding: (member: typeof membership) => member.is_couple || member.is_parent_delegate,
  pingWedding: vi.fn(),
  logEvent: vi.fn(),
}));

const old = "a".repeat(32);
const active = "b".repeat(32);
const expired = "c".repeat(32);
const revoked = "d".repeat(32);
const future = "2099-11-25T10:00:00Z";
const past = "2000-11-25T10:00:00Z";

function query(rows: Record<string, unknown>[]) {
  let selected = rows;
  let projection: string[] | undefined;
  const get = () => ({
    data: projection ? selected.map((row) => Object.fromEntries(
      projection!.filter((key) => key in row).map((key) => [key, row[key]]),
    )) : selected,
    error: null,
  });
  const filter = (key: string, predicate: (v: unknown) => boolean) => {
    selected = selected.filter((row) => !(key in row) || predicate(row[key]));
    return builder;
  };
  const builder = {
    select: (columns: string) => {
      if (columns !== "*") {
        // Match PostgREST column projection while keeping filter inputs available.
        projection = columns.split(", ").filter((column) => !column.includes("("));
      }
      return builder;
    },
    order: () => builder,
    eq: (key: string, value: unknown) => filter(key, (actual) => actual === value),
    neq: (key: string, value: unknown) => filter(key, (actual) => actual !== value),
    gt: (key: string, value: string) => filter(key, (actual) => typeof actual === "string" && actual > value),
    single: async () => ({ data: get().data[0], error: null }),
    maybeSingle: async () => ({ data: get().data[0] ?? null, error: null }),
    then: <T,>(resolve: (value: ReturnType<typeof get>) => T) => resolve(get()),
  };
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  membership.is_parent_delegate = false;
  const rows: Record<string, Record<string, unknown>[]> = {
    weddings: [{ id: "wedding", stage: "booking", partner_a: "Ana", partner_b: "Ben", city: "Pune", wedding_date: "2027-01-20", budget_inr: 12345 }],
    guests: [
      { id: "own", name: "Own guest", wedding_id: "wedding", household_id: "family-a", invited_by: "member", rsvp_token: active, rsvp_expires_at: future },
      { id: "same", name: "Same household guest", wedding_id: "wedding", household_id: "family-a", invited_by: "another", rsvp_token: "shared", rsvp_expires_at: future },
      { id: "other", name: "Other household guest", wedding_id: "wedding", household_id: "family-b", invited_by: "parent", rsvp_token: "other", rsvp_expires_at: future },
    ],
    vendors: [
      { id: "active", wedding_id: "wedding", view_token: active, view_expires_at: future, status: "accepted", functions: ["sangeet"], quote_inr: 1000, committed_inr: 1000 },
      { id: "expired", wedding_id: "wedding", view_token: expired, view_expires_at: past, status: "accepted" },
      { id: "cancelled", wedding_id: "wedding", view_token: revoked, view_expires_at: future, status: "cancelled" },
    ],
    functions: [
      { wedding_id: "wedding", kind: "sangeet", title: "Sangeet" },
      { wedding_id: "wedding", kind: "other", title: "sangeet" },
      { wedding_id: "wedding", kind: "ceremony", title: "Ceremony" },
    ],
    priorities: [{ wedding_id: "wedding", household_id: "family-a", note: "Private household priority" }],
    approvals: [
      { wedding_id: "wedding", function_kind: "sangeet", approved_activities: [{ title: "Dance", start: 1, end: 2, requestedBy: "private" }] },
      { wedding_id: "wedding", function_kind: "ceremony", approved_activities: [{ title: "Ceremony" }] },
    ],
  };
  from.mockImplementation((table: string) => query(rows[table] ?? []));
});

describe("lifecycle access", () => {
  it("keeps RSVP links with their inviter and amounts with the couple", async () => {
    const view = await lifecycleView(42);
    expect(view.spend).toBeNull();
    expect(view.vendors[0]).toMatchObject({ quote_inr: null, committed_inr: null, viewUrl: null });
    expect(view.guests).toMatchObject([{ id: "own", rsvpUrl: `/rsvp/${active}` }, { id: "same", rsvpUrl: null }]);
    membership.is_parent_delegate = true;
    const delegated = await lifecycleView(42);
    expect(delegated.guests).toMatchObject([{ id: "own" }, { id: "same", rsvpUrl: "/rsvp/shared" }]);
    expect(delegated.spend).toBeNull();
  });

  it("keeps private household contributions and budget outside the guest payload", async () => {
    const view = await guestView(active);
    expect(view.wedding).toEqual({ partner_a: "Ana", partner_b: "Ben", city: "Pune", wedding_date: "2027-01-20" });
    expect(JSON.stringify(view)).not.toContain("Private household priority");
    expect(from).not.toHaveBeenCalledWith("priorities");
  });

  it("rejects a parent's self-asserted role for vendor acceptance", async () => {
    await expect(lifecycleAction(42, "wedding", { type: "vendor_accepted" })).rejects.toMatchObject({ status: 403 });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects old links and only shares the assigned vendor timeline", async () => {
    for (const invalid of [old, expired, revoked, "malformed"]) {
      await expect(vendorRunSheet(invalid)).rejects.toMatchObject({ status: 404 });
    }
    const sheet = await vendorRunSheet(active);
    expect(sheet.functions).toMatchObject([{ kind: "sangeet", timeline: [{ title: "Dance", start: 1, end: 2 }] }]);
    expect(sheet.functions[0].timeline[0]).not.toHaveProperty("requestedBy");
    expect(sheet.vendor).not.toHaveProperty("quote_inr");
  });
});
