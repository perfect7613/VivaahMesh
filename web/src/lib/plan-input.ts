/**
 * Pure helpers for the planning API: input validation and fact supersession.
 * Kept free of I/O (and of `server-only`) so they can be unit-tested.
 */
import type { Activity, Fact, FactKind } from "@/lib/compiler/types";

export const FACT_KINDS: FactKind[] = ["music_cutoff", "dinner_start", "makeup_ready", "coverage_end", "overtime_rate"];
const STATUSES: Fact["status"][] = ["confirmed", "conditional", "unresolved"];

export interface FactInput {
  weddingId?: string;
  kind: FactKind;
  functionKind: string;
  value: number | null;
  status: Fact["status"];
  wording: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validates a typed fact. Strict on `value`: it must be JSON `null` or an integer number.
 * Strings, booleans and "" are rejected, so nothing can silently become minute 0 (midnight).
 */
export function parseFactInput(body: unknown): Parsed<FactInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "bad_body" };
  const b = body as Record<string, unknown>;

  if (b.weddingId !== undefined && typeof b.weddingId !== "string") return { ok: false, error: "bad_wedding" };
  if (typeof b.kind !== "string" || !FACT_KINDS.includes(b.kind as FactKind)) return { ok: false, error: "bad_kind" };
  const kind = b.kind as FactKind;

  const status = (b.status ?? "confirmed") as Fact["status"];
  if (!STATUSES.includes(status)) return { ok: false, error: "bad_status" };

  const functionKind = typeof b.functionKind === "string" ? b.functionKind.trim().slice(0, 40) : "";
  if (!functionKind) return { ok: false, error: "bad_function" };

  const raw = b.value === undefined ? null : b.value;
  if (raw !== null && (typeof raw !== "number" || !Number.isInteger(raw))) return { ok: false, error: "bad_value" };
  const max = kind === "overtime_rate" ? 10_000_000 : 1440;
  if (raw !== null && (raw < 0 || raw > max)) return { ok: false, error: "bad_value" };
  if (status === "confirmed" && raw === null) return { ok: false, error: "confirmed_needs_value" };

  const wording = typeof b.wording === "string" ? b.wording.trim().slice(0, 300) : "";
  return { ok: true, value: { weddingId: b.weddingId as string | undefined, kind, functionKind, value: raw, status, wording } };
}

/**
 * The facts a new fact of the same kind and function must supersede: every one still live.
 * Superseding only the newest would leave an older contradicting answer in force.
 */
export function liveFactIds(rows: { id: string; supersedes: string[] | null }[]): string[] {
  const superseded = new Set(rows.flatMap((r) => r.supersedes ?? []));
  return rows.filter((r) => !superseded.has(r.id)).map((r) => r.id);
}

const ACTIVITY_KINDS: Activity["kind"][] = ["dance", "dinner", "makeup", "ritual", "coverage", "music", "other"];

/** Shape of a row in the `activities` table (the columns the compiler needs). */
export interface ActivityRow {
  key: string;
  function_kind: string;
  title: string;
  kind: Activity["kind"];
  start_min: number;
  end_min: number;
  flexible: boolean;
  requires_amplified_music: boolean;
  can_overlap_with: string[] | null;
  requested_by_side: "A" | "B" | null;
  requested_by_name: string | null;
  priority: "must" | "prefer" | "nice" | null;
}

/** DB row → compiler Activity. Every field the compiler reads survives the round trip. */
export function activityFromRow(r: ActivityRow): Activity {
  const overlap = (r.can_overlap_with ?? []).filter((k): k is Activity["kind"] => ACTIVITY_KINDS.includes(k as Activity["kind"]));
  return {
    id: r.key,
    functionKind: r.function_kind,
    title: r.title,
    kind: r.kind,
    start: r.start_min,
    end: r.end_min,
    flexible: r.flexible,
    requiresAmplifiedMusic: r.requires_amplified_music || undefined,
    canOverlapWith: overlap.length ? overlap : undefined,
    requestedBy: r.requested_by_side
      ? { side: r.requested_by_side, memberName: r.requested_by_name ?? "", priority: r.priority ?? "prefer" }
      : undefined,
  };
}

/** Compiler Activity → DB row. */
export function activityToRow(a: Activity): ActivityRow {
  return {
    key: a.id,
    function_kind: a.functionKind,
    title: a.title,
    kind: a.kind,
    start_min: a.start,
    end_min: a.end,
    flexible: a.flexible,
    requires_amplified_music: !!a.requiresAmplifiedMusic,
    can_overlap_with: a.canOverlapWith ?? [],
    requested_by_side: a.requestedBy?.side ?? null,
    requested_by_name: a.requestedBy?.memberName ?? null,
    priority: a.requestedBy?.priority ?? null,
  };
}

/**
 * Who may record a fact. Anyone in the wedding can report one as `conditional` or `unresolved`
 * (a claim waiting for confirmation), but a `confirmed` fact becomes a hard input to the plan and
 * replaces what is on file, so only the couple can record one by hand. Vendor answers arrive
 * through their own channels (a call, a quote), not through this route.
 */
export function canRecordFact(isCouple: boolean, status: Fact["status"]): boolean {
  return status !== "confirmed" || isCouple;
}
