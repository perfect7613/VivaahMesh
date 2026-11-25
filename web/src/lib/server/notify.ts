import "server-only";
import { db } from "./supabase";
import { escapeHtml, sendWithApp } from "./telegram-bot";
import { pickLang, type Lang } from "@/lib/i18n";

const joinedCopy: Record<Lang, (name: string, family: string) => string> = {
  en: (n, f) => `🎉 <b>${n}</b> joined with the <b>${f}</b>.`,
  hi: (n, f) => `🎉 <b>${n}</b> <b>${f}</b> के साथ जुड़ गए।`,
  mr: (n, f) => `🎉 <b>${n}</b> <b>${f}</b>सोबत सामील झाले.`,
};
const openCopy: Record<Lang, string> = { en: "Open our wedding", hi: "हमारी शादी खोलें", mr: "आमचं लग्न उघडा" };

/** Tell every other Telegram member of the wedding about a change, each in their own language. */
export async function notifyWedding(weddingId: string, actorMemberId: string, kind: "joined") {
  const s = db();
  const { data: members } = await s
    .from("members")
    .select("id, tg_user_id, display_name, language, household:households(name)")
    .eq("wedding_id", weddingId);
  if (!members) return;
  const actor = members.find((m) => m.id === actorMemberId);
  if (!actor) return;
  const family = (actor.household as unknown as { name: string } | null)?.name ?? "";
  await Promise.allSettled(
    members
      .filter((m) => m.id !== actorMemberId && m.tg_user_id)
      .map((m) => {
        const lang = pickLang(m.language);
        if (kind === "joined") {
          return sendWithApp(
            Number(m.tg_user_id),
            joinedCopy[lang](escapeHtml(actor.display_name), escapeHtml(family)),
            openCopy[lang],
            `/tg?wedding=${weddingId}`,
          );
        }
      }),
  );
}
