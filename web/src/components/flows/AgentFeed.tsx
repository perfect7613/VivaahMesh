"use client";
import { useCallback, useEffect, useState } from "react";
import { base, type BaseLang, type Lang } from "@/lib/i18n";
import { api, haptic } from "@/lib/client/telegram";
import { useWeddingLive } from "@/lib/client/live";

interface Run {
  id: string;
  trigger: "message" | "voice" | "call_result" | "heartbeat" | "manual" | "group" | "approval";
  model: string;
  status: "done" | "running";
  text: string | null;
  at: string;
  messages: string[];
}

const COPY: Record<BaseLang, { checkNow: string; checking: string; empty: string; trig: Record<Run["trigger"], string>; told: (n: number) => string; powered: string; ask: string; askPlaceholder: string; thinking: string; busy: string; searched: string; saved: string; group: string; groupHint: string }> = {
  en: {
    checkNow: "Check now",
    checking: "Checking…",
    empty: "The agent checks the plan every few minutes and whenever someone writes. Nothing to report yet.",
    trig: { message: "after a message", voice: "after a voice note", call_result: "after the venue call", heartbeat: "routine check", manual: "on request", group: "after your family group chat", approval: "after the couple approved" },
    told: (n) => (n === 1 ? "messaged 1 group" : `messaged ${n} groups`),
    powered: "GLM-5.3 on Sarvam · runs all the time",
    ask: "Ask",
    askPlaceholder: "Ask anything: “Mehendi artists in Pune under ₹10k?”",
    thinking: "Thinking… (may search the web)",
    busy: "I'm in the middle of something. Ask again in a minute.",
    searched: "Searched the web",
    saved: "Saved to your family's notes",
    group: "Add me to your family group",
    groupHint: "I'll read your family's group chat and keep the plan up to date. Notes stay private to your family.",
  },
  hi: {
    checkNow: "अभी जाँचें",
    checking: "जाँच हो रही है…",
    empty: "एजेंट हर कुछ मिनट में और हर संदेश पर प्लान जाँचता है। अभी बताने को कुछ नहीं।",
    trig: { message: "संदेश के बाद", voice: "वॉइस नोट के बाद", call_result: "वेन्यू कॉल के बाद", heartbeat: "नियमित जाँच", manual: "आपके कहने पर", group: "परिवार के ग्रुप चैट के बाद", approval: "जोड़े की मंज़ूरी के बाद" },
    told: (n) => `${n} समूह को संदेश भेजा`,
    powered: "Sarvam पर GLM-5.3 · हमेशा चालू",
    ask: "पूछें",
    askPlaceholder: "कुछ भी पूछें: “पुणे में ₹10 हज़ार तक मेहंदी आर्टिस्ट?”",
    thinking: "सोच रहा हूँ… (वेब पर खोज सकता हूँ)",
    busy: "अभी एक काम चल रहा है। एक मिनट बाद पूछें।",
    searched: "वेब पर खोजा",
    saved: "आपके परिवार के नोट्स में सहेजा",
    group: "मुझे परिवार के ग्रुप में जोड़ें",
    groupHint: "मैं आपके परिवार का ग्रुप चैट पढ़कर प्लान अपडेट रखूँगा। नोट्स आपके परिवार तक ही रहेंगे।",
  },
  mr: {
    checkNow: "आत्ता तपासा",
    checking: "तपासत आहे…",
    empty: "एजंट दर काही मिनिटांनी आणि प्रत्येक मेसेजनंतर प्लॅन तपासतो. सध्या सांगण्यासारखं काही नाही.",
    trig: { message: "मेसेजनंतर", voice: "व्हॉइस नोटनंतर", call_result: "वेन्यू कॉलनंतर", heartbeat: "नियमित तपासणी", manual: "तुमच्या सांगण्यावरून", group: "कुटुंबाच्या ग्रुप चॅटनंतर", approval: "जोडप्याच्या मंजुरीनंतर" },
    told: (n) => `${n} गटाला मेसेज केला`,
    powered: "Sarvam वर GLM-5.3 · सतत चालू",
    ask: "विचारा",
    askPlaceholder: "काहीही विचारा: “पुण्यात ₹10 हजारांत मेहंदी आर्टिस्ट?”",
    thinking: "विचार करतोय… (वेबवर शोधू शकतो)",
    busy: "सध्या एक काम चालू आहे. एका मिनिटाने विचारा.",
    searched: "वेबवर शोधलं",
    saved: "तुमच्या कुटुंबाच्या नोट्समध्ये जतन केलं",
    group: "मला कुटुंबाच्या ग्रुपमध्ये जोडा",
    groupHint: "मी तुमच्या कुटुंबाचा ग्रुप चॅट वाचून प्लॅन अद्ययावत ठेवीन. नोट्स तुमच्या कुटुंबापुरत्याच राहतील.",
  },
};

function ago(iso: string, lang: Lang) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(lang === "en" ? "en-IN" : `${lang}-IN`, { numeric: "auto" });
  } catch {
    rtf = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });
  }
  return min < 60 ? rtf.format(-min, "minute") : rtf.format(-Math.round(min / 60), "hour");
}

/** What the always-on agent noticed and did, so families can see who is following up. */
export function AgentFeed({ weddingId, lang, groupLink }: { weddingId: string; lang: Lang; groupLink?: string | null }) {
  const c = COPY[base(lang)];
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [chat, setChat] = useState<{ q: string; a: string; searched?: string[]; saved?: number }[]>([]);
  async function ask() {
    const q = question.trim();
    if (!q || asking) return;
    haptic.tap();
    setAsking(true);
    setQuestion("");
    try {
      const r = await api<{ answer: string | null; busy?: boolean; searched?: string[]; notesSaved?: number }>("/api/agent/ask", { body: { weddingId, question: q } });
      setChat((x) => [...x, { q, a: r.answer ?? c.busy, searched: r.searched, saved: r.notesSaved }]);
      haptic.success();
      load();
    } catch (e) {
      setChat((x) => [...x, { q, a: (e as Error).message }]);
      haptic.error();
    } finally {
      setAsking(false);
    }
  }
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(() => api<{ runs: Run[] }>(`/api/agent?wedding=${weddingId}`).then((r) => setRuns(r.runs)).catch(() => {}), [weddingId]);
  useWeddingLive(weddingId, load);

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
      <div className="border-b border-line px-4 py-3">
        {chat.map((m, i) => (
          <div key={i} className="mb-3">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-marigold-soft px-3.5 py-2 text-[15px]">{m.q}</p>
            <div className="mt-2 max-w-[92%] rounded-2xl rounded-bl-md border border-line px-3.5 py-2.5 text-[15px] leading-relaxed">
              <p className="whitespace-pre-wrap break-words">{m.a}</p>
              {m.searched?.length || m.saved ? (
                <p className="mt-1.5 text-[12px] text-muted">
                  {m.searched?.length ? `🔎 ${c.searched}` : ""}
                  {m.searched?.length && m.saved ? " · " : ""}
                  {m.saved ? `📝 ${c.saved}` : ""}
                </p>
              ) : null}
            </div>
          </div>
        ))}
        {asking ? <p className="mb-3 text-[14px] text-muted">{c.thinking}</p> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
          className="flex gap-2"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={c.askPlaceholder}
            maxLength={1000}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-[15px] outline-none focus:border-marigold"
          />
          <button type="submit" disabled={asking || !question.trim()} className="pressable min-h-11 rounded-xl bg-sindoor px-4 text-[15px] font-semibold text-white disabled:opacity-50">
            {c.ask}
          </button>
        </form>
      </div>
      {groupLink ? (
        <a href={groupLink} target="_blank" rel="noreferrer" className="pressable flex items-start gap-3 border-b border-line px-5 py-3.5">
          <span aria-hidden className="text-xl">👨‍👩‍👧‍👦</span>
          <span className="flex-1">
            <span className="block text-[15px] font-medium">{c.group}</span>
            <span className="block text-[13px] leading-snug text-muted">{c.groupHint}</span>
          </span>
          <span aria-hidden className="text-xl text-muted">›</span>
        </a>
      ) : null}
      {runs === null ? (
        <div className="h-20 animate-pulse" />
      ) : runs.length === 0 ? (
        <p className="px-5 py-4 text-[15px] leading-relaxed text-body">{c.empty}</p>
      ) : (
        <ol className="flex flex-col">
          {runs.slice(0, 5).map((r, i) => (
            <li key={r.id} className={`px-5 py-3.5 ${i ? "border-t border-line" : ""}`}>
              <p className="text-[15px] leading-snug">{r.status === "running" ? c.checking : r.text}</p>
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
