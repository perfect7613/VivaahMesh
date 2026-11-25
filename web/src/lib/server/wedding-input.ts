import "server-only";

import { HttpError } from "./weddings";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function textField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value == null) return undefined;
  if (typeof value !== "string" || /[\u0000\uD800-\uDFFF]/u.test(value)) {
    throw new HttpError(400, `bad_${key}`);
  }
  return value;
}

export function stringList(body: Record<string, unknown>, key: string, limit: number) {
  if (body[key] == null) return [];
  const raw = body[key];
  if (!Array.isArray(raw)) throw new HttpError(400, `bad_${key}`);
  const items = raw.slice(0, limit);
  if (items.some((item) => typeof item !== "string" || /[\u0000\uD800-\uDFFF]/u.test(item))) {
    throw new HttpError(400, `bad_${key}`);
  }
  return items as string[];
}

export function integerField(body: Record<string, unknown>, key: string, min: number, max: number) {
  const value = body[key];
  if (value == null) return null;
  const rounded = typeof value === "number" ? Math.round(value) : NaN;
  if (!Number.isSafeInteger(rounded) || rounded < min || rounded > max) {
    throw new HttpError(400, `bad_${key}`);
  }
  return rounded;
}

export function dateField(body: Record<string, unknown>, key: string) {
  const value = textField(body, key);
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000")) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().startsWith(`${value}T`)) return value;
  }
  throw new HttpError(400, `bad_${key}`);
}

export function uuidField(body: Record<string, unknown>, key: string): string;
export function uuidField(body: Record<string, unknown>, key: string, optional: true): string | undefined;
export function uuidField(body: Record<string, unknown>, key: string, optional = false) {
  const value = textField(body, key);
  if (optional && value === undefined) return undefined;
  if (!value || !uuid.test(value)) throw new HttpError(400, `bad_${key}`);
  return value.toLowerCase();
}

export function visibilityField(body: Record<string, unknown>) {
  const value = textField(body, "visibility") ?? "shared";
  if (value !== "shared" && value !== "household") throw new HttpError(400, "bad_visibility");
  return value;
}
