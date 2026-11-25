import { publicRoute } from "@/lib/server/public-route";
import { guestReserve, guestRsvp, guestView } from "@/lib/server/lifecycle";
import { jsonObject } from "@/lib/server/request-body";
import { uuidField } from "@/lib/server/wedding-input";
import { HttpError } from "@/lib/server/weddings";

type Ctx = { params: Promise<{ token: string }> };

export const GET = publicRoute<Ctx>(async (_req, { params }) => guestView((await params).token));

export const POST = publicRoute<Ctx>(async (req, { params }) => {
  const { token } = await params;
  const b = await jsonObject(req, 4096);
  if (b.reserve !== undefined) return guestReserve(token, uuidField(b, "reserve"));
  if (typeof b.attending !== "boolean") throw new HttpError(400, "bad_attending");
  const people = count(b.people, 1, "people");
  const veg = count(b.veg, 0, "veg");
  return guestRsvp(token, uuidField(b, "functionId"), b.attending, people, veg);
});

function count(value: unknown, fallback: number, key: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 20) {
    throw new HttpError(400, `bad_${key}`);
  }
  return value;
}
