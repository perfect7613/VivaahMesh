import "server-only";
import { db } from "./supabase";
import { escapeHtml, sendWithApp } from "./telegram-bot";
import { pickLang, type BaseLang } from "@/lib/i18n";
import { localized } from "./translate";

const joinedCopy: Record<BaseLang, (name: string, family: string) => string> = {
  en: (n, f) => `🎉 <b>${n}</b> joined with the <b>${f}</b>.`,
  hi: (n, f) => `🎉 <b>${n}</b> <b>${f}</b> के साथ जुड़ गए।`,
  mr: (n, f) => `🎉 <b>${n}</b> <b>${f}</b>सोबत सामील झाले.`,
};
const openCopy: Record<BaseLang, string> = { en: "Open our wedding", hi: "हमारी शादी खोलें", mr: "आमचं लग्न उघडा" };

/** Tell every other Telegram member of the wedding about a change, each in their own language. */
export async function notifyWedding(weddingId: string, actorMemberId: string) {
  const s = db();
  const [{ data: actor }, { data: recipients }] = await Promise.all([
    s.from("members").select("display_name, household:households(name)")
      .eq("wedding_id", weddingId).eq("id", actorMemberId).maybeSingle(),
    s.from("members").select("tg_user_id, language").eq("wedding_id", weddingId)
      .neq("id", actorMemberId).gt("tg_user_id", 0).order("created_at").limit(1000),
  ]);
  if (!actor || !recipients) return;
  const family = (actor.household as unknown as { name: string } | null)?.name ?? "";
  const name = escapeHtml(actor.display_name);
  const familyName = escapeHtml(family);
  const text = { en: joinedCopy.en(name, familyName), hi: joinedCopy.hi(name, familyName), mr: joinedCopy.mr(name, familyName) };
  const localizedByLanguage = new Map<string, Promise<[string, string]>>();
  const batchSize = 10;
  for (let start = 0; start < recipients.length; start += batchSize) {
    await Promise.allSettled(recipients.slice(start, start + batchSize).map(async (member) => {
      const lang = pickLang(member.language);
      let copy = localizedByLanguage.get(lang);
      if (!copy) {
        copy = Promise.all([localized(text, lang), localized(openCopy, lang)]);
        localizedByLanguage.set(lang, copy);
      }
      const [message, button] = await copy;
      await sendWithApp(Number(member.tg_user_id), message, button, `/tg?wedding=${weddingId}`);
    }));
  }
}
