import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { db } from "./supabase";
import { canManageWedding, HttpError, logEvent, memberships, pingWedding } from "./weddings";
import { dateField, integerField, stringList, textField, uuidField } from "./wedding-input";
import { flagsForMember } from "./flags";
import { runAgent } from "./agent";
import { STAGES, areaOpen, nextStage, openAfterWedding, rsvpCounts, spendSummary, type Area } from "../lifecycle";

type Member = Awaited<ReturnType<typeof memberships>>[number];

async function member(tgUserId: number, weddingId?: string) {
  const me = (await memberships(tgUserId)).find((m) => !weddingId || m.wedding_id === weddingId);
  if (!me) throw new HttpError(403, "not_a_member");
  return me;
}
const decider = canManageWedding;
const vendorCategories = ["venue", "caterer", "decor", "photo_video", "makeup", "dj_music", "mehendi", "pandit", "other"];
const expiryDate = () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
const bearerToken = () => randomUUID().replaceAll("-", "");

function validateToken(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new HttpError(404, "invalid_link");
}

function check(error: unknown) {
  if (error) throw error;
}

function moneyField(action: Record<string, unknown>, field: string) {
  const raw = action[field];
  if (raw == null || raw === "") return undefined;
  // Existing planner inputs submit optional rupee amounts as decimal strings.
  const value = typeof raw === "string" && /^\d{1,16}(?:\.\d{1,2})?$/.test(raw.trim()) ? Number(raw) : raw;
  return integerField({ [field]: value }, field, 0, Number.MAX_SAFE_INTEGER) ?? undefined;
}

async function gates(me: Member) {
  const [{ data: w, error }, flags] = await Promise.all([db().from("weddings").select("stage").eq("id", me.wedding_id).single(), flagsForMember(me)]);
  check(error);
  const stage = w!.stage;
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
  const guests = s.from("guests").select("id, name, party_size, rsvp_token, rsvp_expires_at, invited_by")
    .eq("wedding_id", W).order("created_at");
  const [g, ts, vs, gs, rs, items, fns, ms] = await Promise.all([
    gates(me),
    s.from("tasks").select("*").eq("wedding_id", W).order("created_at"),
    s.from("vendors").select("*").eq("wedding_id", W).order("created_at"),
    me.household_id ? guests.eq("household_id", me.household_id) : Promise.resolve({ data: [], error: null }),
    s.from("rsvps").select("function_id, attending, people, veg, guests!inner(wedding_id), functions!inner(wedding_id)").eq("guests.wedding_id", W).eq("functions.wedding_id", W),
    s.from("registry_items").select("id, title, price_inr, reserved_by, reserved_at").eq("wedding_id", W).order("created_at"),
    s.from("functions").select("id, title, kind, on_date").eq("wedding_id", W).order("sort"),
    s.from("members").select("id, display_name").eq("wedding_id", W),
  ]);
  for (const result of [ts, vs, gs, rs, items, fns, ms]) check(result.error);
  const now = Date.now();
  const name = (id: string | null) => (ms.data ?? []).find((m) => m.id === id)?.display_name ?? null;
  const vendors = vs.data ?? [];
  const tasks = ts.data ?? [];
  return {
    me: { id: me.id, isCouple: me.is_couple, decider: decider(me) },
    stage: g.stage,
    next: nextStage(g.stage),
    open: g.open,
    flagSource: g.source,
    tasks: tasks.map((t) => ({
      id: t.id, title: t.title, kind: t.kind, status: t.status, due_date: t.due_date, escalated: t.escalated, seeded: t.seeded,
      owner: name(t.owner_member_id) ?? t.owner_label, signedOffBy: name(t.signed_off_by),
      canEdit: decider(me) || t.owner_member_id === me.id,
    })),
    vendors: vendors.map((v) => ({
      id: v.id, name: v.name, category: v.category, origin: v.origin, functions: v.functions, status: v.status, seeded: v.seeded,
      quote_inr: me.is_couple ? v.quote_inr : null,
      planned_inr: me.is_couple ? v.planned_inr : null, committed_inr: me.is_couple ? v.committed_inr : null,
      invoice_inr: me.is_couple ? v.invoice_inr : null, paid_inr: me.is_couple ? v.paid_inr : null,
      authorizedBy: name(v.authorized_by), authorized_at: v.authorized_at, accepted_at: v.accepted_at, paid_at: v.paid_at,
      viewUrl: decider(me) && v.status !== "cancelled" && Date.parse(v.view_expires_at) > now ? `/vendor/${v.view_token}` : null,
    })),
    spend: me.is_couple ? spendSummary(vendors) : null,
    openDeliverables: openAfterWedding(tasks).length,
    functions: fns.data ?? [],
    guests: (gs.data ?? []).map((x) => {
      const canManageLink = decider(me) || x.invited_by === me.id;
      return { id: x.id, name: x.name, party: x.party_size, canManageLink,
        rsvpUrl: canManageLink && Date.parse(x.rsvp_expires_at) > now ? `/rsvp/${x.rsvp_token}` : null };
    }),
    rsvp: rsvpCounts(rs.data ?? []),
    registry: (items.data ?? []).map((i) => ({ id: i.id, title: i.title, price_inr: i.price_inr, reserved: !!i.reserved_by, reservedBy: me.is_couple ? (gs.data ?? []).find((x) => x.id === i.reserved_by)?.name ?? null : null })),
  };
}

export async function lifecycleAction(tgUserId: number, weddingId: string | undefined, a: Record<string, unknown>) {
  const me = await member(tgUserId, weddingId);
  const s = db();
  const W = me.wedding_id;
  const text = (key: string, max: number) => textField(a, key)?.trim().slice(0, max).replace(/[\uD800-\uDFFF]$/u, "") || "";
  const id = (key: string) => uuidField(a, key);
  const requireCouple = () => { if (!me.is_couple) throw new HttpError(403, "couple_only"); };
  const requireDecider = () => { if (!decider(me)) throw new HttpError(403, "parents_or_couple_only"); };
  const vendor = async () => {
    const { data, error } = await s.from("vendors").select("id, name, quote_inr, status, invoice_inr, committed_inr, authorized_by").eq("id", id("vendorId")).eq("wedding_id", W).maybeSingle();
    check(error);
    if (!data) throw new HttpError(404, "no_vendor");
    return data;
  };

  switch (a.type) {
    case "advance_stage": {
      requireCouple();
      const previous = textField(a, "expectedStage");
      if (!previous || !(STAGES as readonly string[]).includes(previous)) throw new HttpError(400, "bad_expected_stage");
      const { data, error } = await s.rpc("advance_wedding_stage", { p_wedding: W, p_member: me.id, p_expected: previous });
      check(error);
      if (data === "couple_only") throw new HttpError(403, data);
      if (data !== "ok") throw new HttpError(409, data === "already_last_stage" ? data : "stage_changed");
      break;
    }
    case "add_task": {
      const title = text("title", 120);
      if (!title) throw new HttpError(400, "title_required");
      const assigned = uuidField(a, "ownerMemberId", true) ?? me.id;
      if (assigned !== me.id) {
        requireDecider();
        const { data, error } = await s.from("members").select("id").eq("id", assigned).eq("wedding_id", W).maybeSingle();
        check(error);
        if (!data) throw new HttpError(404, "no_owner");
      }
      const { data: w, error: stageError } = await s.from("weddings").select("stage").eq("id", W).single();
      check(stageError);
      check((await s.from("tasks").insert({
        wedding_id: W, title, kind: a.kind === "deliverable" ? "deliverable" : "task", stage: w!.stage,
        owner_member_id: assigned, owner_label: text("ownerLabel", 60) || null, due_date: dateField(a, "dueDate"),
      })).error);
      break;
    }
    case "task_status": {
      if (a.status !== "open" && a.status !== "done" && a.status !== "blocked") throw new HttpError(400, "bad_status");
      const update = s.from("tasks").update({
        status: a.status, evidence: a.evidence !== undefined ? text("evidence", 300) || null : undefined,
        done_at: a.status === "done" ? new Date().toISOString() : null,
      }).eq("id", id("taskId")).eq("wedding_id", W);
      const { data, error } = await (decider(me) ? update : update.eq("owner_member_id", me.id)).select("id").maybeSingle();
      check(error);
      if (!data) throw new HttpError(404, "no_owned_task");
      break;
    }
    case "sign_off": {
      requireCouple();
      await requireArea(me, "closeout");
      const { data, error } = await s.from("tasks").update({ signed_off_by: me.id, signed_off_at: new Date().toISOString() })
        .eq("id", id("taskId")).eq("wedding_id", W).is("signed_off_at", null).select("id").maybeSingle();
      check(error);
      if (!data) throw new HttpError(409, "task_unavailable");
      break;
    }
    case "add_vendor": {
      requireDecider();
      await requireArea(me, "sourcing");
      const name = text("name", 80);
      const category = textField(a, "category");
      if (!name) throw new HttpError(400, "name_required");
      if (!category || !vendorCategories.includes(category)) throw new HttpError(400, "bad_category");
      if (a.origin !== "family" && a.origin !== "sourced") throw new HttpError(400, "bad_origin");
      const functions = stringList(a, "functions", 10).map((fn) => fn.trim().slice(0, 40).replace(/[\uD800-\uDFFF]$/u, "")).filter(Boolean);
      const q = moneyField(a, "quoteInr");
      check((await s.from("vendors").insert({ wedding_id: W, name, category, origin: a.origin, functions,
        quote_inr: q ?? null, planned_inr: q ?? null, run_sheet: text("runSheet", 2000) || null })).error);
      break;
    }
    case "authorize_vendor":
    case "vendor_accepted": {
      requireDecider();
      await requireArea(me, "booking");
      const v = await vendor();
      const authorizing = a.type === "authorize_vendor";
      const prior = authorizing ? "shortlisted" : "authorized";
      if (v.status !== prior) throw new HttpError(409, "vendor_state_changed");
      const override = authorizing ? moneyField(a, "committedInr") : undefined;
      if (override !== undefined) requireCouple();
      const now = new Date().toISOString();
      const patch = authorizing
        ? { status: "authorized", authorized_by: me.id, authorized_at: now, committed_inr: override ?? v.quote_inr }
        : { status: "accepted", accepted_at: now };
      const { data, error } = await s.from("vendors").update(patch).eq("id", v.id).eq("wedding_id", W).eq("status", prior).select("id").maybeSingle();
      check(error);
      if (!data) throw new HttpError(409, "vendor_state_changed");
      if (authorizing) await logEvent(W, me.id, "vendor_authorized", { vendor: v.name });
      break;
    }
    case "vendor_money": {
      requireCouple();
      const v = await vendor();
      if (v.status !== "authorized" && v.status !== "accepted") throw new HttpError(409, "authorize_first");
      const invoice = moneyField(a, "invoiceInr");
      const paid = moneyField(a, "paidInr");
      if (invoice === undefined && paid === undefined) throw new HttpError(400, "amount_required");
      const { data, error } = await s.from("vendors").update({
        invoice_inr: invoice, ...(paid !== undefined ? { paid_inr: paid, paid_at: new Date().toISOString() } : {}),
      }).eq("id", v.id).eq("wedding_id", W).in("status", ["authorized", "accepted"]).select("id").maybeSingle();
      check(error);
      if (!data) throw new HttpError(409, "vendor_state_changed");
      // #14: an invoice that differs from the approved amount gets an owner: whoever authorized the booking.
      const inv = invoice ?? v.invoice_inr;
      if (inv != null && v.committed_inr != null && inv !== v.committed_inr) {
        const title = `Invoice from ${v.name} is ₹${(inv - v.committed_inr).toLocaleString("en-IN")} off the approved ₹${Number(v.committed_inr).toLocaleString("en-IN")}`;
        const { data: open } = await s.from("tasks").select("id").eq("vendor_id", v.id).eq("kind", "incident").eq("status", "open").like("title", "Invoice from%").maybeSingle();
        if (open) await s.from("tasks").update({ title }).eq("id", open.id);
        else check((await s.from("tasks").insert({ wedding_id: W, title, kind: "incident", owner_member_id: v.authorized_by ?? me.id, vendor_id: v.id, escalated: true, stage: "closeout" })).error);
      }
      break;
    }
    case "cancel_vendor": {
      requireDecider();
      const v = await vendor();
      const { data, error } = await s.rpc("cancel_lifecycle_vendor", { p_wedding: W, p_vendor: v.id, p_member: me.id, p_reason: text("reason", 120) });
      check(error);
      if (data === "forbidden") throw new HttpError(403, "parents_or_couple_only");
      if (data === "ok") {
        after(() => runAgent(W, "manual").catch(() => console.error("agent after cancellation")));
      }
      break;
    }
    case "rotate_vendor_link": {
      requireDecider();
      const { data, error } = await s.from("vendors").update({ view_token: bearerToken(), view_expires_at: expiryDate() })
        .eq("id", id("vendorId")).eq("wedding_id", W).neq("status", "cancelled").select("id").maybeSingle();
      check(error);
      if (!data) throw new HttpError(404, "no_vendor");
      break;
    }
    case "add_guest": {
      await requireArea(me, "guests");
      if (!me.household_id) throw new HttpError(403, "no_household");
      const name = text("name", 80);
      if (!name) throw new HttpError(400, "name_required");
      const party = integerField({ party: a.party === 0 ? 1 : a.party }, "party", 1, 20) ?? 1;
      check((await s.from("guests").insert({ wedding_id: W, household_id: me.household_id, invited_by: me.id, name, party_size: party })).error);
      break;
    }
    case "rotate_guest_link": {
      if (!me.household_id) throw new HttpError(403, "no_household");
      const update = s.from("guests").update({ rsvp_token: bearerToken(), rsvp_expires_at: expiryDate() })
        .eq("id", id("guestId")).eq("wedding_id", W).eq("household_id", me.household_id);
      const { data, error } = await (decider(me) ? update : update.eq("invited_by", me.id)).select("id").maybeSingle();
      check(error);
      if (!data) throw new HttpError(404, "no_guest");
      break;
    }
    case "add_registry": {
      requireCouple();
      const title = text("title", 80);
      if (!title) throw new HttpError(400, "title_required");
      check((await s.from("registry_items").insert({ wedding_id: W, title, price_inr: moneyField(a, "priceInr") ?? null })).error);
      break;
    }
    default:
      throw new HttpError(400, "unknown_action");
  }
  await pingWedding(W);
  return lifecycleView(tgUserId, W);
}

/* ---------------- Guest page (/rsvp/<token>): no Telegram needed, sees only their own things ---------------- */

async function guestByToken(token: string) {
  validateToken(token);
  const { data, error } = await db().from("guests").select("id, wedding_id, name, party_size").eq("rsvp_token", token)
    .gt("rsvp_expires_at", new Date().toISOString()).maybeSingle();
  check(error);
  if (!data) throw new HttpError(404, "invalid_link");
  return data;
}

export async function guestView(token: string) {
  const g = await guestByToken(token);
  const s = db();
  const [w, fns, rs, items] = await Promise.all([
    s.from("weddings").select("partner_a, partner_b, wedding_date, city").eq("id", g.wedding_id).single(),
    s.from("functions").select("id, title, kind, on_date, starts_at, venue").eq("wedding_id", g.wedding_id).order("sort"),
    s.from("rsvps").select("function_id, attending, people, veg, functions!inner(wedding_id)").eq("guest_id", g.id).eq("functions.wedding_id", g.wedding_id),
    s.from("registry_items").select("id, title, price_inr, reserved_by").eq("wedding_id", g.wedding_id).order("created_at"),
  ]);
  for (const result of [w, fns, rs, items]) check(result.error);
  return {
    guest: { name: g.name, party: g.party_size },
    wedding: w.data,
    functions: fns.data ?? [],
    rsvps: (rs.data ?? []).map(({ function_id, attending, people, veg }) => ({ function_id, attending, people, veg })),
    // Who reserved what stays private: a guest only learns "taken" or "yours".
    registry: (items.data ?? []).map((i) => ({ id: i.id, title: i.title, price_inr: i.price_inr, state: i.reserved_by === g.id ? "mine" : i.reserved_by ? "taken" : "free" })),
  };
}

export async function guestRsvp(token: string, functionId: string, attending: boolean, people: number, veg: number) {
  const g = await guestByToken(token);
  const { data, error } = await db().rpc("record_guest_rsvp", {
    p_token: token, p_function: functionId, p_attending: attending, p_people: people, p_veg: veg,
  });
  check(error);
  if (data !== "ok") throw new HttpError(404, data === "no_function" ? "no_function" : "invalid_link");
  await pingWedding(g.wedding_id);
  return guestView(token);
}

export async function guestReserve(token: string, itemId: string) {
  const g = await guestByToken(token);
  const { data, error } = await db().rpc("reserve_guest_registry_item", { p_item: itemId, p_token: token });
  check(error);
  if (data === "invalid_link") throw new HttpError(404, "invalid_link");
  if (data !== "ok") throw new HttpError(409, "already_reserved");
  await pingWedding(g.wedding_id);
  return guestView(token);
}

/* ---------------- Vendor page (/vendor/<token>): only that vendor's approved items ---------------- */

export async function vendorRunSheet(token: string) {
  const s = db();
  validateToken(token);
  const { data: v, error } = await s.from("vendors").select("id, wedding_id, name, category, functions, status, run_sheet")
    .eq("view_token", token).neq("status", "cancelled").gt("view_expires_at", new Date().toISOString()).maybeSingle();
  check(error);
  if (!v) throw new HttpError(404, "invalid_link");
  const [w, fns, ap] = await Promise.all([
    s.from("weddings").select("partner_a, partner_b, wedding_date, city").eq("id", v.wedding_id).single(),
    s.from("functions").select("kind, title, on_date, starts_at, venue").eq("wedding_id", v.wedding_id).order("sort"),
    s.from("approvals").select("function_kind, approved_activities, created_at").eq("wedding_id", v.wedding_id).order("created_at", { ascending: false }),
  ]);
  for (const result of [w, fns, ap]) check(result.error);
  const functions = fns.data ?? [];
  const knownKinds = new Set(functions.filter((f) => f.kind !== "other").map((f) => f.kind));
  const assigned = new Set(v.functions as string[]);
  const mine = functions.filter((f) => f.kind === "other"
    ? !knownKinds.has(f.title) && assigned.has(f.title)
    : assigned.has(f.kind));
  // Only the couple-APPROVED timeline, never proposals, budgets or other vendors' terms.
  const approved = new Map<string, { title: string; start: number; end: number }[]>();
  for (const a of ap.data ?? []) {
    if (!approved.has(a.function_kind) && Array.isArray(a.approved_activities)) approved.set(a.function_kind, a.approved_activities as { title: string; start: number; end: number }[]);
  }
  return {
    vendor: { name: v.name, category: v.category, status: v.status, runSheet: v.run_sheet },
    wedding: w.data,
    functions: mine.map((f) => ({ ...f, timeline: (f.kind === "other" ? [] : approved.get(f.kind) ?? []).map((x) => ({ title: x.title, start: x.start, end: x.end })) })),
  };
}
