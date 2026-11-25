import "server-only";
import { db } from "./supabase";
import { HttpError, logEvent, memberships } from "./weddings";
import { flagsForMember } from "./flags";
import { runAgent } from "./agent";
import { STAGES, areaOpen, nextStage, openAfterWedding, rsvpCounts, spendSummary, type Area } from "@/lib/lifecycle";

type Member = Awaited<ReturnType<typeof memberships>>[number];

async function member(tgUserId: number, weddingId?: string) {
  const me = (await memberships(tgUserId)).find((m) => !weddingId || m.wedding_id === weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  return me;
}
const decider = (me: Member) => me.is_couple || me.role === "parent";

async function gates(me: Member) {
  const [{ data: w }, flags] = await Promise.all([db().from("weddings").select("stage").eq("id", me.wedding_id).single(), flagsForMember(me)]);
  const stage = w?.stage ?? "brief";
  const on = Object.fromEntries(Object.entries(flags.features).map(([k, v]) => [k, v.enabled]));
  const f = { source: flags.source, on };
  const open = Object.fromEntries((STAGES.slice(1) as Area[]).map((a) => [a, areaOpen(a, stage, f)])) as Record<Area, boolean>;
  return { stage, open, source: flags.source };
}

async function requireArea(me: Member, area: Area) {
  const g = await gates(me);
  if (!g.open[area]) throw new HttpError(409, `stage_locked:${area}`);
  return g;
}

/** Everything the Planner screen needs. Amounts are couple-only; guest names stay with the families. */
export async function lifecycleView(tgUserId: number, weddingId?: string) {
  const me = await member(tgUserId, weddingId);
  const s = db();
  const W = me.wedding_id;
  const [g, ts, vs, gs, rs, items, fns, ms] = await Promise.all([
    gates(me),
    s.from("tasks").select("*").eq("wedding_id", W).order("created_at"),
    s.from("vendors").select("*").eq("wedding_id", W).order("created_at"),
    s.from("guests").select("id, name, party_size, household_id, rsvp_token").eq("wedding_id", W).order("created_at"),
    s.from("rsvps").select("guest_id, function_id, attending, people, veg, guests!inner(wedding_id)").eq("guests.wedding_id", W),
    s.from("registry_items").select("id, title, price_inr, reserved_by, reserved_at").eq("wedding_id", W).order("created_at"),
    s.from("functions").select("id, title, kind, on_date").eq("wedding_id", W).order("sort"),
    s.from("members").select("id, display_name").eq("wedding_id", W),
  ]);
  const name = (id: string | null) => (ms.data ?? []).find((m) => m.id === id)?.display_name ?? null;
  const vendors = vs.data ?? [];
  const tasks = ts.data ?? [];
  return {
    me: { id: me.id, isCouple: me.is_couple, decider: decider(me) },
    stage: g.stage,
    next: nextStage(g.stage),
    open: g.open,
    flagSource: g.source,
    tasks: tasks.map((t) => ({ ...t, owner: name(t.owner_member_id) ?? t.owner_label, signedOffBy: name(t.signed_off_by) })),
    vendors: vendors.map((v) => ({
      id: v.id, name: v.name, category: v.category, origin: v.origin, functions: v.functions, status: v.status, seeded: v.seeded,
      quote_inr: me.is_couple ? v.quote_inr : null,
      planned_inr: me.is_couple ? v.planned_inr : null, committed_inr: me.is_couple ? v.committed_inr : null,
      invoice_inr: me.is_couple ? v.invoice_inr : null, paid_inr: me.is_couple ? v.paid_inr : null,
      authorizedBy: name(v.authorized_by), authorized_at: v.authorized_at, accepted_at: v.accepted_at, paid_at: v.paid_at,
      viewUrl: decider(me) ? `/vendor/${v.view_token}` : null,
    })),
    spend: me.is_couple ? spendSummary(vendors) : null,
    openDeliverables: openAfterWedding(tasks).length,
    functions: fns.data ?? [],
    guests: (gs.data ?? []).map((x) => ({ id: x.id, name: x.name, party: x.party_size, rsvpUrl: `/rsvp/${x.rsvp_token}` })),
    rsvp: rsvpCounts(rs.data ?? []),
    registry: (items.data ?? []).map((i) => ({ id: i.id, title: i.title, price_inr: i.price_inr, reserved: !!i.reserved_by, reservedBy: me.is_couple ? (gs.data ?? []).find((x) => x.id === i.reserved_by)?.name ?? null : null })),
  };
}

type Action =
  | { type: "advance_stage" }
  | { type: "add_task"; title: string; kind?: string; ownerMemberId?: string; ownerLabel?: string; dueDate?: string }
  | { type: "task_status"; taskId: string; status: "open" | "done" | "blocked"; evidence?: string }
  | { type: "sign_off"; taskId: string }
  | { type: "add_vendor"; name: string; category: string; origin: "family" | "sourced"; functions?: string[]; quoteInr?: number; runSheet?: string }
  | { type: "authorize_vendor"; vendorId: string; committedInr?: number }
  | { type: "vendor_accepted"; vendorId: string }
  | { type: "vendor_money"; vendorId: string; invoiceInr?: number; paidInr?: number }
  | { type: "cancel_vendor"; vendorId: string; reason?: string }
  | { type: "add_guest"; name: string; party?: number }
  | { type: "add_registry"; title: string; priceInr?: number };

export async function lifecycleAction(tgUserId: number, weddingId: string | undefined, a: Action) {
  const me = await member(tgUserId, weddingId);
  const s = db();
  const W = me.wedding_id;
  const str = (x: unknown, max = 120) => String(x ?? "").trim().slice(0, max);
  const money = (x: unknown) => (x === undefined || x === null || x === "" ? undefined : Math.max(0, Math.round(Number(x))) || 0);
  const vendor = async (id: string) => {
    const { data } = await s.from("vendors").select("*").eq("id", id).eq("wedding_id", W).maybeSingle();
    if (!data) throw new HttpError(404, "no_vendor");
    return data;
  };

  switch (a.type) {
    case "advance_stage": {
      // Moving the wedding forward is the couple's call. Flagsmith reads the new wedding_stage trait.
      if (!me.is_couple) throw new HttpError(403, "couple_only");
      const { data: w } = await s.from("weddings").select("stage").eq("id", W).single();
      const next = nextStage(w!.stage);
      if (!next) throw new HttpError(409, "already_last_stage");
      await s.from("weddings").update({ stage: next }).eq("id", W).eq("stage", w!.stage);
      await logEvent(W, me.id, "stage_advanced", { from: w!.stage, to: next });
      break;
    }
    case "add_task": {
      const title = str(a.title);
      if (!title) throw new HttpError(400, "title_required");
      const { data: w } = await s.from("weddings").select("stage").eq("id", W).single();
      await s.from("tasks").insert({
        wedding_id: W, title, kind: ["task", "deliverable"].includes(String(a.kind)) ? a.kind : "task", stage: w!.stage,
        owner_member_id: a.ownerMemberId || me.id, owner_label: str(a.ownerLabel, 60) || null, due_date: a.dueDate || null,
      });
      break;
    }
    case "task_status": {
      await s.from("tasks").update({ status: a.status, evidence: a.evidence ? str(a.evidence, 300) : undefined, done_at: a.status === "done" ? new Date().toISOString() : null }).eq("id", a.taskId).eq("wedding_id", W);
      break;
    }
    case "sign_off": {
      await requireArea(me, "closeout");
      if (!me.is_couple) throw new HttpError(403, "couple_only");
      await s.from("tasks").update({ signed_off_by: me.id, signed_off_at: new Date().toISOString() }).eq("id", a.taskId).eq("wedding_id", W);
      break;
    }
    case "add_vendor": {
      await requireArea(me, "sourcing");
      if (!decider(me)) throw new HttpError(403, "parents_or_couple_only");
      const name = str(a.name, 80);
      if (!name) throw new HttpError(400, "name_required");
      const q = money(a.quoteInr);
      await s.from("vendors").insert({ wedding_id: W, name, category: a.category, origin: a.origin === "family" ? "family" : "sourced", functions: (a.functions ?? []).slice(0, 10), quote_inr: q ?? null, planned_inr: q ?? null, run_sheet: a.runSheet ? str(a.runSheet, 2000) : null });
      break;
    }
    case "authorize_vendor": {
      // Booking is a material decision: only an authorized person, and only once booking is open.
      await requireArea(me, "booking");
      if (!decider(me)) throw new HttpError(403, "parents_or_couple_only");
      const v = await vendor(a.vendorId);
      await s.from("vendors").update({ status: "authorized", authorized_by: me.id, authorized_at: new Date().toISOString(), committed_inr: money(a.committedInr) ?? v.quote_inr }).eq("id", v.id);
      await logEvent(W, me.id, "vendor_authorized", { vendor: v.name });
      break;
    }
    case "vendor_accepted": {
      await requireArea(me, "booking");
      const v = await vendor(a.vendorId);
      if (v.status !== "authorized") throw new HttpError(409, "authorize_first");
      await s.from("vendors").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", v.id);
      break;
    }
    case "vendor_money": {
      if (!me.is_couple) throw new HttpError(403, "couple_only");
      const v = await vendor(a.vendorId);
      const paid = money(a.paidInr);
      await s.from("vendors").update({ invoice_inr: money(a.invoiceInr) ?? v.invoice_inr, ...(paid !== undefined ? { paid_inr: paid, paid_at: new Date().toISOString() } : {}) }).eq("id", v.id);
      break;
    }
    case "cancel_vendor": {
      // #13: a cancellation becomes an owned incident plus a replacement task, and the agent re-plans.
      if (!decider(me)) throw new HttpError(403, "parents_or_couple_only");
      const v = await vendor(a.vendorId);
      await s.from("vendors").update({ status: "cancelled" }).eq("id", v.id);
      const due = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
      // Same keys in both rows: PostgREST bulk inserts need matching columns.
      const { error: tErr } = await s.from("tasks").insert([
        { wedding_id: W, title: `${v.name} cancelled${a.reason ? `: ${str(a.reason, 120)}` : ""}`, kind: "incident", owner_member_id: me.id, vendor_id: v.id, due_date: null, escalated: true, seeded: v.seeded },
        { wedding_id: W, title: `Find a replacement ${v.category.replace("_", " ")} for ${(v.functions as string[]).join(", ") || "the wedding"}`, kind: "replacement", owner_member_id: me.id, vendor_id: v.id, due_date: due, escalated: false, seeded: v.seeded },
      ]);
      if (tErr) throw tErr;
      await logEvent(W, me.id, "vendor_cancelled", { vendor: v.name, category: v.category });
      runAgent(W, "manual", { note: `Vendor ${v.name} (${v.category}) cancelled. Tell the deciders what changes and what to do next.` }).catch((e) => console.error("agent after cancellation", e));
      break;
    }
    case "add_guest": {
      await requireArea(me, "guests");
      const name = str(a.name, 80);
      if (!name) throw new HttpError(400, "name_required");
      await s.from("guests").insert({ wedding_id: W, household_id: me.household_id, name, party_size: Math.min(20, Math.max(1, Number(a.party) || 1)) });
      break;
    }
    case "add_registry": {
      if (!me.is_couple) throw new HttpError(403, "couple_only");
      const title = str(a.title, 80);
      if (!title) throw new HttpError(400, "title_required");
      await s.from("registry_items").insert({ wedding_id: W, title, price_inr: money(a.priceInr) ?? null });
      break;
    }
    default:
      throw new HttpError(400, "unknown_action");
  }
  return lifecycleView(tgUserId, W);
}

/* ---------------- Guest page (/rsvp/<token>): no Telegram needed, sees only their own things ---------------- */

async function guestByToken(token: string) {
  const { data } = await db().from("guests").select("id, wedding_id, name, party_size").eq("rsvp_token", token).maybeSingle();
  if (!data) throw new HttpError(404, "invalid_link");
  return data;
}

export async function guestView(token: string) {
  const g = await guestByToken(token);
  const s = db();
  const [w, fns, rs, items] = await Promise.all([
    s.from("weddings").select("partner_a, partner_b, wedding_date, city").eq("id", g.wedding_id).single(),
    s.from("functions").select("id, title, kind, on_date, starts_at, venue").eq("wedding_id", g.wedding_id).order("sort"),
    s.from("rsvps").select("function_id, attending, people, veg").eq("guest_id", g.id),
    s.from("registry_items").select("id, title, price_inr, reserved_by").eq("wedding_id", g.wedding_id).order("created_at"),
  ]);
  return {
    guest: { name: g.name, party: g.party_size },
    wedding: w.data,
    functions: fns.data ?? [],
    rsvps: rs.data ?? [],
    // Who reserved what stays private: a guest only learns "taken" or "yours".
    registry: (items.data ?? []).map((i) => ({ id: i.id, title: i.title, price_inr: i.price_inr, state: i.reserved_by === g.id ? "mine" : i.reserved_by ? "taken" : "free" })),
  };
}

export async function guestRsvp(token: string, functionId: string, attending: boolean, people: number, veg: number) {
  const g = await guestByToken(token);
  const { data: f } = await db().from("functions").select("id").eq("id", functionId).eq("wedding_id", g.wedding_id).maybeSingle();
  if (!f) throw new HttpError(404, "no_function");
  const p = attending ? Math.min(g.party_size, Math.max(1, Math.round(people) || 1)) : 0;
  await db().from("rsvps").upsert({ guest_id: g.id, function_id: f.id, attending, people: p, veg: Math.min(p, Math.max(0, Math.round(veg) || 0)), updated_at: new Date().toISOString() });
  await logEvent(g.wedding_id, null, "rsvp", { function_id: f.id, attending });
  return guestView(token);
}

export async function guestReserve(token: string, itemId: string) {
  const g = await guestByToken(token);
  const { data: ok, error } = await db().rpc("reserve_registry_item", { p_item: itemId, p_guest: g.id });
  if (error) throw error;
  if (!ok) throw new HttpError(409, "already_reserved");
  return guestView(token);
}

/* ---------------- Vendor page (/vendor/<token>): only that vendor's approved items ---------------- */

export async function vendorRunSheet(token: string) {
  const s = db();
  const { data: v } = await s.from("vendors").select("id, wedding_id, name, category, functions, status, run_sheet").eq("view_token", token).maybeSingle();
  if (!v) throw new HttpError(404, "invalid_link");
  const [w, fns, ap] = await Promise.all([
    s.from("weddings").select("partner_a, partner_b, wedding_date, city").eq("id", v.wedding_id).single(),
    s.from("functions").select("kind, title, on_date, starts_at, venue").eq("wedding_id", v.wedding_id).order("sort"),
    s.from("approvals").select("function_kind, approved_activities, created_at").eq("wedding_id", v.wedding_id).order("created_at", { ascending: false }),
  ]);
  const mine = (fns.data ?? []).filter((f) => (v.functions as string[]).includes(f.kind) || (v.functions as string[]).includes(f.title));
  // Only the couple-APPROVED timeline, never proposals, budgets or other vendors' terms.
  const approved = new Map<string, { title: string; start: number; end: number }[]>();
  for (const a of ap.data ?? []) {
    if (!approved.has(a.function_kind) && Array.isArray(a.approved_activities)) approved.set(a.function_kind, a.approved_activities as { title: string; start: number; end: number }[]);
  }
  return {
    vendor: { name: v.name, category: v.category, status: v.status, runSheet: v.run_sheet },
    wedding: w.data,
    functions: mine.map((f) => ({ ...f, timeline: (approved.get(f.kind) ?? []).map((x) => ({ title: x.title, start: x.start, end: x.end })) })),
  };
}
