import { authed } from "@/lib/server/route";
import { addFunction, HttpError, updateFunction, weddingView } from "@/lib/server/weddings";
import { jsonObject } from "@/lib/server/request-body";
import { dateField, textField, uuidField } from "@/lib/server/wedding-input";

/** Add a function by name (Roka, Tilak, Jaggo, Nikah…). Couple or parents. */
export const POST = authed(async (req, viewer) => {
  const body = await jsonObject(req);
  const weddingId = uuidField(body, "weddingId");
  await addFunction(viewer.id, weddingId, textField(body, "title") ?? "");
  return { view: await weddingView(viewer.id, weddingId) };
});

/** Fill in a function's date, start time, venue and notes. Couple or parents. */
export const PATCH = authed(async (req, viewer) => {
  const body = await jsonObject(req);
  const startsAt = textField(body, "startsAt") || null;
  if (startsAt && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startsAt)) {
    throw new HttpError(400, "bad_startsAt");
  }
  const weddingId = await updateFunction(viewer.id, {
    functionId: uuidField(body, "functionId"),
    title: textField(body, "title"),
    onDate: dateField(body, "onDate"),
    startsAt,
    venue: textField(body, "venue"),
    details: textField(body, "details"),
  });
  return { view: await weddingView(viewer.id, weddingId) };
});
