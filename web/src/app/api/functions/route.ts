import { authed } from "@/lib/server/route";
import { addFunction, updateFunction, weddingView } from "@/lib/server/weddings";

/** Add a function by name (Roka, Tilak, Jaggo, Nikah…). Couple or parents. */
export const POST = authed(async (req, viewer) => {
  const b = (await req.json().catch(() => ({}))) as { weddingId?: string; title?: string };
  await addFunction(viewer.id, String(b.weddingId ?? ""), String(b.title ?? ""));
  return { view: await weddingView(viewer.id, b.weddingId) };
});

/** Fill in a function's date, start time, venue and notes. Couple or parents. */
export const PATCH = authed(async (req, viewer) => {
  const b = (await req.json().catch(() => ({}))) as Parameters<typeof updateFunction>[1];
  const weddingId = await updateFunction(viewer.id, b);
  return { view: await weddingView(viewer.id, weddingId) };
});
