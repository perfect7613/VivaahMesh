"use client";
import { useCallback, useEffect, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { api, haptic } from "@/lib/client/telegram";

interface Run {
  id: string;
  trigger: "message" | "voice" | "call_result" | "heartbeat" | "manual";
  model: string;
  status: "done" | "running";
  summary: { en: string; hi: string; mr: string } | null;
  at: string;
  messages: string[];
}

const COPY: Record<Lang, { checkNow: string; checking: string; empty: string; trig: Record<Run["trigger"], string>; told: (n: number) => string; powered: string }> = {
  en: {
    checkNow: "Check now",
    checking: "Checking…",
    empty: "The agent checks the plan every few minutes and whenever someone writes. Nothing to report yet.",
    trig: { message: "after a message", voice: "after a voice note", call_result: "after the venue call", heartbeat: "routine check", manual: "on request" },
    told: (n) => (n === 1 ? "messaged 1 group" : `messaged ${n} groups`),
    powered: "GLM-5.3 on Sarvam · runs all the time",
  },
  hi: {
    checkNow: "अभी जाँचें",
    checking: "जाँच हो रही है…",
    empty: "एजेंट हर कुछ मिनट में और हर संदेश पर प्लान जाँचता है। अभी बताने को कुछ नहीं।",
    trig: { message: "संदेश के बाद", voice: "वॉइस नोट के बाद", call_result: "वेन्यू कॉल के बाद", heartbeat: "नियमित जाँच", manual: "आपके कहने पर" },
    told: (n) => `${n} समूह को संदेश भेजा`,
    powered: "Sarvam पर GLM-5.3 · हमेशा चालू",
  },
  mr: {
    checkNow: "आत्ता तपासा",
    checking: "तपासत आहे…",
    empty: "एजंट दर काही मिनिटांनी आणि प्रत्येक मेसेजनंतर प्लॅन तपासतो. सध्या सांगण्यासारखं काही नाही.",
    trig: { message: "मेसेजनंतर", voice: "व्हॉइस नोटनंतर", call_result: "वेन्यू कॉलनंतर", heartbeat: "नियमित तपासणी", manual: "तुमच्या सांगण्यावरून" },
    told: (n) => `${n} गटाला मेसेज केला`,
    powered: "Sarvam वर GLM-5.3 · सतत चालू",
  },
};

function ago(iso: string, lang: Lang) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  const rtf = new Intl.RelativeTimeFormat(lang === "en" ? "en-IN" : `${lang}-IN`, { numeric: "auto" });
  return min < 60 ? rtf.format(-min, "minute") : rtf.format(-Math.round(min / 60), "hour");
}

/** What the always-on agent noticed and did, so families can see who is following up. */
export function AgentFeed({ weddingId, lang }: { weddingId: string; lang: Lang }) {
  const c = COPY[lang];
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(() => api<{ runs: Run[] }>(`/api/agent?wedding=${weddingId}`).then((r) => setRuns(r.runs)).catch(() => {}), [weddingId]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(() => document.visibilityState === "visible" && load(), checking ? 3000 : 10000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load, checking]);

  useEffect(() => {
    if (!checking) return;
    const stop = setTimeout(() => setChecking(false), 45000);
    return () => clearTimeout(stop);
  }, [checking]);

  async function checkNow() {
    haptic.tap();
    setChecking(true);
    const before = runs?.[0]?.id;
    await api("/api/agent", { body: { weddingId } }).catch(() => setChecking(false));
    // Stop the spinner as soon as a new finished run shows up.
    const poll = setInterval(async () => {
      const r = await api<{ runs: Run[] }>(`/api/agent?wedding=${weddingId}`).catch(() => null);
      if (!r) return;
      setRuns(r.runs);
      if (r.runs[0] && r.runs[0].id !== before && r.runs[0].status === "done") {
        clearInterval(poll);
        setChecking(false);
        haptic.success();
      }
    }, 2500);
    setTimeout(() => clearInterval(poll), 45000);
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-card">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span className="relative flex size-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-mehendi opacity-50" />
          <span className="relative inline-flex size-2.5 rounded-full bg-mehendi" />
        </span>
        <span className="flex-1 text-[13px] text-muted">{c.powered}</span>
        <button type="button" onClick={checkNow} disabled={checking} className="pressable rounded-full border border-marigold/50 px-3 py-1 text-[13px] font-medium text-sindoor disabled:opacity-60">
          {checking ? c.checking : c.checkNow}
        </button>
      </div>
      {runs === null ? (
        <div className="h-20 animate-pulse" />
      ) : runs.length === 0 ? (
        <p className="px-5 py-4 text-[15px] leading-relaxed text-body">{c.empty}</p>
      ) : (
        <ol className="flex flex-col">
          {runs.slice(0, 5).map((r, i) => (
            <li key={r.id} className={`px-5 py-3.5 ${i ? "border-t border-line" : ""}`}>
              <p className="text-[15px] leading-snug">{r.status === "running" ? c.checking : r.summary?.[lang] ?? r.summary?.en}</p>
              <p className="mt-1 text-[12px] text-muted">
                {ago(r.at, lang)} · {c.trig[r.trigger]}
                {r.messages.length ? ` · ${c.told(r.messages.length)}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
