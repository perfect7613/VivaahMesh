import { uiStrings } from "@/lib/server/translate";

export const maxDuration = 60;

/** Mini App UI strings for a non-hand-written language (public: they are the same for everyone). */
export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get("lang") ?? "";
  try {
    const data = await uiStrings(lang);
    if (!data) return Response.json({ error: "unsupported" }, { status: 404 });
    return Response.json({ lang, data }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch (e) {
    console.error("ui strings", lang, e);
    return Response.json({ error: "translation_failed" }, { status: 502 });
  }
}
