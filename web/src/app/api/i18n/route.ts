import { authed } from "@/lib/server/route";
import { uiStrings } from "@/lib/server/translate";

export const maxDuration = 60;

/** Mini App UI strings for a non-hand-written language (identical for every viewer). */
export const GET = authed(async (req) => {
  const lang = new URL(req.url).searchParams.get("lang") ?? "";
  try {
    const data = await uiStrings(lang);
    if (!data) return Response.json({ error: "unsupported" }, { status: 404 });
    return Response.json({ lang, data }, { headers: { "cache-control": "private, max-age=3600" } });
  } catch {
    console.error("ui strings failed");
    return Response.json({ error: "translation_failed" }, { status: 502 });
  }
});
