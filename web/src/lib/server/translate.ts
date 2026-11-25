import "server-only";
import { db } from "./supabase";
import { chat, translate } from "./sarvam";
import { LANGS, isBase, sarvamCode, serializeEnglish, type BaseLang } from "@/lib/i18n";

/**
 * Every language Sarvam supports. Marathi, Hindi and English are hand-written; any other language
 * is translated from English: short messages by Sarvam Translate, the whole Mini App UI once by
 * GLM-5.3 (Sarvam Token Factory) and cached in the database.
 */

const memo = new Map<string, string>();

/** One message for one reader: the hand-written version if there is one, else a Sarvam translation. */
export async function localized(texts: Record<BaseLang, string>, lang: string): Promise<string> {
  if (isBase(lang)) return texts[lang];
  const k = `${lang}\u0000${texts.en}`;
  const hit = memo.get(k);
  if (hit) return hit;
  try {
    const out = await translate(texts.en, sarvamCode(lang));
    memo.set(k, out);
    return out;
  } catch (e) {
    console.error("translate failed", lang, e);
    return texts.en;
  }
}

type Serialized = ReturnType<typeof serializeEnglish>;
const inflight = new Map<string, Promise<Serialized>>();

/** The Mini App's strings in `lang`, translated once by GLM and stored in ui_strings. */
export async function uiStrings(lang: string): Promise<Serialized | null> {
  if (isBase(lang) || !LANGS.some((l) => l.code === lang)) return null;
  const { data } = await db().from("ui_strings").select("data").eq("lang", lang).maybeSingle();
  if (data?.data) return data.data as Serialized;
  if (!inflight.has(lang)) inflight.set(lang, buildStrings(lang).finally(() => inflight.delete(lang)));
  return inflight.get(lang)!;
}

async function buildStrings(lang: string): Promise<Serialized> {
  const name = LANGS.find((l) => l.code === lang)!.hint;
  const source = serializeEnglish();
  const keys = Object.keys(source);
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += 45) chunks.push(keys.slice(i, i + 45));
  const parts = await Promise.all(
    chunks.map(async (ks) => {
      const slice = Object.fromEntries(ks.map((k) => [k, source[k]]));
      const { message } = await chat({
        model: "glm5.3-flash",
        reasoning: "low",
        json: true,
        maxTokens: 8000,
        messages: [
          {
            role: "system",
            content:
              `You translate the user interface of a wedding-planning app for Indian families into ${name}, in its usual script. ` +
              "Return the same JSON object with the same keys and structure; translate only the string values. " +
              "Keep placeholders like ⟦0⟧ ⟦1⟧ exactly, keep emoji, HTML tags and ₹ amounts, and keep the names VivaahMesh, Telegram, WhatsApp, Flagsmith, Sarvam and @vivaah_bot. " +
              "Use warm, simple, everyday words a grandparent would understand. Output JSON only.",
          },
          { role: "user", content: JSON.stringify(slice) },
        ],
      });
      const text = (message.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "");
      try {
        return JSON.parse(text) as Serialized;
      } catch {
        return {} as Serialized;
      }
    }),
  );
  const merged = Object.assign({}, ...parts) as Serialized;
  // Only keep entries that kept their shape (and every placeholder) so a bad chunk falls back to English.
  const clean: Serialized = {};
  for (const k of keys) {
    const src = source[k];
    const t = merged[k];
    if (typeof src === "string" && typeof t === "string") clean[k] = t;
    else if (src && typeof src === "object" && "$fn" in src && t && typeof t === "object" && "$fn" in t) {
      const need = String(src.$fn).match(/⟦\d⟧/g) ?? [];
      if (need.every((n) => String(t.$fn).includes(n))) clean[k] = t;
    } else if (src && typeof src === "object" && t && typeof t === "object" && !("$fn" in t)) clean[k] = t;
  }
  if (Object.keys(clean).length > keys.length * 0.6) {
    await db().from("ui_strings").upsert({ lang, data: clean, model: "glm5.3-flash" });
  }
  return clean;
}
