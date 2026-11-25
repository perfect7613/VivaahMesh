"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { PhoneCall } from "lucide-react";
import { inputClass } from "@/components/ui";
type VenueCallStatus = "awaiting_consent" | "ready" | "starting" | "started" | "browser_ready" | "call_failed" | "result_saved" | "resolved" | "unresolved" | "blocked";
import { isBase, LANGS, type BaseLang } from "@/lib/i18n";
import { BrowserCall, type BrowserCallConfig } from "./BrowserCall";

interface ConsentView {
  recipientName: string;
  purpose: string;
  functionKind?: string;
  language?: BaseLang | null;
  promptVariant?: "baseline" | "clarify_scope" | null;
  status: VenueCallStatus;
  channel: "phone" | "browser" | null;
  browserConfig?: BrowserCallConfig;
}

const text = {
  en: {
    title: "A quick call about the venue", loading: "Checking your consent link…",
    missing: "This consent link has expired or is unavailable. Ask the family for a new link.",
    loadFailed: "Could not load the call details.", retry: "Try again",
    stale: "Could not check for updates. This page will try again.",
    language: "Your language", forRecipient: "Recipient",
    purpose: "Confirm when amplified music must stop at this function.",
    evidence: "Sarvam’s voice assistant will ask one question. Your answer is saved to update the wedding plan and can be seen by both households.",
    agree: "I agree to take this one-time voice call and have my answer saved.",
    consent: "Give consent", saving: "Saving consent…", saveFailed: "Could not save your consent. Try again.",
    waiting: "Consent received. The family can now authorize the call. Keep this page open for a browser call.",
    ringing: "The family authorized this phone call. Please answer when your phone rings.",
    browser: "The family authorized a voice call in this browser.",
    received: "Your answer was received. Thank you for helping with the wedding.",
    unresolved: "We still need to confirm the venue’s answer. The family can follow up.",
    unavailable: "The call is unavailable right now. Ask the family to follow up.",
  },
  hi: {
    title: "वेन्यू के बारे में एक छोटी कॉल", loading: "सहमति का लिंक जाँच रहे हैं…",
    missing: "यह लिंक उपलब्ध नहीं है या इसकी समय-सीमा पूरी हो गई है। परिवार से नया लिंक माँगें।",
    loadFailed: "कॉल की जानकारी लोड नहीं हुई।", retry: "फिर कोशिश करें",
    stale: "नए अपडेट नहीं मिले। यह पेज फिर कोशिश करेगा।",
    language: "आपकी भाषा", forRecipient: "कॉल किसके लिए है",
    purpose: "इस कार्यक्रम में स्पीकर पर संगीत कब बंद करना है, इसकी पुष्टि करें।",
    evidence: "Sarvam का वॉइस असिस्टेंट एक सवाल पूछेगा। शादी की योजना अपडेट करने के लिए आपका जवाब सेव होगा और दोनों परिवार उसे देख सकेंगे।",
    agree: "मैं इस एक बार की वॉइस कॉल और अपना जवाब सेव करने के लिए सहमत हूँ।",
    consent: "सहमति दें", saving: "सहमति सेव हो रही है…", saveFailed: "सहमति सेव नहीं हुई। फिर कोशिश करें।",
    waiting: "सहमति मिल गई। परिवार अब कॉल की अनुमति दे सकता है। ब्राउज़र कॉल के लिए यह पेज खुला रखें।",
    ringing: "परिवार ने फ़ोन कॉल की अनुमति दे दी है। फ़ोन बजने पर कॉल उठाएँ।",
    browser: "परिवार ने इस ब्राउज़र में वॉइस कॉल की अनुमति दे दी है।",
    received: "आपका जवाब मिल गया। शादी की तैयारी में मदद के लिए धन्यवाद।",
    unresolved: "वेन्यू के जवाब की पुष्टि अभी बाकी है। परिवार फिर संपर्क कर सकता है।",
    unavailable: "कॉल अभी उपलब्ध नहीं है। परिवार से दोबारा संपर्क करने के लिए कहें।",
  },
  mr: {
    title: "कार्यक्रमस्थळाबद्दल एक छोटा कॉल", loading: "संमतीची लिंक तपासत आहोत…",
    missing: "ही लिंक उपलब्ध नाही किंवा तिची मुदत संपली आहे. कुटुंबाकडून नवीन लिंक मागा.",
    loadFailed: "कॉलची माहिती लोड झाली नाही.", retry: "पुन्हा प्रयत्न करा",
    stale: "नवीन माहिती मिळाली नाही. हे पान पुन्हा प्रयत्न करेल.",
    language: "तुमची भाषा", forRecipient: "कॉल कोणासाठी आहे",
    purpose: "या कार्यक्रमात स्पीकरवरील संगीत किती वाजता बंद करायचे याची खात्री करा.",
    evidence: "Sarvam चा व्हॉइस असिस्टंट एक प्रश्न विचारेल. लग्नाची योजना अपडेट करण्यासाठी तुमचे उत्तर जतन केले जाईल आणि दोन्ही कुटुंबांना दिसेल.",
    agree: "मी या एकदाच होणाऱ्या व्हॉइस कॉलला आणि माझे उत्तर जतन करण्याला संमती देते किंवा देतो.",
    consent: "संमती द्या", saving: "संमती जतन होत आहे…", saveFailed: "संमती जतन झाली नाही. पुन्हा प्रयत्न करा.",
    waiting: "संमती मिळाली. कुटुंब आता कॉलला परवानगी देऊ शकते. ब्राउझर कॉलसाठी हे पान उघडे ठेवा.",
    ringing: "कुटुंबाने फोन कॉलला परवानगी दिली आहे. फोन वाजल्यावर कॉल घ्या.",
    browser: "कुटुंबाने या ब्राउझरमधील व्हॉइस कॉलला परवानगी दिली आहे.",
    received: "तुमचे उत्तर मिळाले. लग्नाच्या तयारीत मदत केल्याबद्दल धन्यवाद.",
    unresolved: "कार्यक्रमस्थळाच्या उत्तराची खात्री होणे बाकी आहे. कुटुंब पुन्हा संपर्क करू शकते.",
    unavailable: "कॉल सध्या उपलब्ध नाही. कुटुंबाला पुन्हा संपर्क करण्यास सांगा.",
  },
};

const focusClass = "focus-visible:ring-2 focus-visible:ring-marigold focus-visible:ring-offset-2 focus-visible:ring-offset-card";
const primaryClass = `pressable min-h-12 w-full rounded-xl border border-marigold bg-marigold-soft px-4 py-2.5 font-semibold disabled:opacity-50 ${focusClass}`;

export function ConsentPage({ token }: { token: string }) {
  const [lang, setLang] = useState<BaseLang>("en");
  const [view, setView] = useState<ConsentView | null>(null);
  const [readError, setReadError] = useState<"missing" | "loadFailed" | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const read = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const gone = useRef(false);
  const endpoint = `/api/calls/consent/${encodeURIComponent(token)}`;
  const t = text[lang];

  const refresh = useCallback(async () => {
    if (read.current || submitting.current || gone.current) return;
    const controller = new AbortController();
    read.current = controller;
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.status === 404 || response.status === 410) {
        gone.current = true;
        setView(null);
        setReadError("missing");
      } else if (response.ok) {
        const details: ConsentView = await response.json();
        if (controller.signal.aborted) return;
        setView(details);
        setReadError(null);
      } else {
        setReadError("loadFailed");
      }
    } catch {
      if (!controller.signal.aborted) setReadError("loadFailed");
    } finally {
      if (read.current === controller) read.current = null;
    }
  }, [endpoint]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    refreshWhenVisible();
    const intervalId = window.setInterval(refreshWhenVisible, 2_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      read.current?.abort();
      read.current = null;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  async function consent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agreed || submitting.current) return;

    read.current?.abort();
    read.current = null;
    submitting.current = true;
    setSaving(true);
    setSubmitError(false);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true, language: lang }),
      });
      if (!response.ok) throw new Error("consent_failed");
      const { status }: { status: VenueCallStatus } = await response.json();
      setView((current) => current ? { ...current, status, language: lang } : current);
    } catch {
      setSubmitError(true);
    } finally {
      submitting.current = false;
      setSaving(false);
      void refresh();
    }
  }

  const pendingConsent = view?.status === "awaiting_consent";
  const browser = view?.browserConfig && (view.status === "browser_ready" || view.status === "started");
  const status = view ? consentStatus(view) : null;

  return (
    <main lang={lang} className="mx-auto min-h-dvh w-full max-w-md space-y-4 px-5 pt-8 pb-12">
      <header className="space-y-2">
        <p className="font-display text-lg">VivaahMesh</p>
        <h1 className="flex items-center gap-2 font-display text-3xl leading-tight">
          <PhoneCall aria-hidden="true" className="size-5 shrink-0 text-marigold" />
          {t.title}
        </h1>
      </header>
      <label className="block space-y-1.5 font-medium">
        <span>{t.language}</span>
        <select disabled={saving} value={lang} className={`${inputClass} min-h-12 py-2`} onChange={(event) => setLang(event.target.value as BaseLang)}>
          {LANGS.filter((option) => isBase(option.code)).map((option) => <option key={option.code} value={option.code} lang={option.code}>{option.label}</option>)}
        </select>
      </label>
      <section className="space-y-4 rounded-2xl border border-line bg-card p-4">
        {!view ? (
          readError ? (
            <>
              <p role="alert">{t[readError]}</p>
              {readError === "loadFailed" ? <button className={primaryClass} type="button" onClick={() => void refresh()}>{t.retry}</button> : null}
            </>
          ) : (
            <div className="space-y-2" role="status">
              <p>{t.loading}</p>
              <div className="h-16 rounded-xl bg-line" aria-hidden="true" />
            </div>
          )
        ) : (
          <>
            <dl className="space-y-1">
              <dt className="text-sm font-medium">{t.forRecipient}</dt>
              <dd className="text-lg font-semibold break-words">{view.recipientName}</dd>
            </dl>
            <p>{lang === "en" || !view.functionKind ? view.purpose : t.purpose}</p>
            {readError ? <p className="rounded-xl border border-marigold p-3 text-sm" role="status">{t.stale}</p> : null}
            {pendingConsent ? (
              <form className="space-y-4" onSubmit={consent} aria-busy={saving}>
                <p>{t.evidence}</p>

                <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line p-3">
                  <input
                    type="checkbox"
                    required
                    checked={agreed}
                    disabled={saving}
                    className={`size-5 shrink-0 accent-marigold ${focusClass}`}
                    onChange={(event) => setAgreed(event.target.checked)}
                  />
                  <span>{t.agree}</span>
                </label>
                {submitError ? <p className="rounded-xl border border-sindoor p-3" role="alert">{t.saveFailed}</p> : null}
                <button type="submit" className={primaryClass} disabled={!agreed || saving || !!readError}>
                  {saving ? t.saving : t.consent}
                </button>
              </form>
            ) : (
              <>
                {status ? <p className="rounded-xl bg-marigold-soft p-3" role="status">{t[status]}</p> : null}
                {browser && view.browserConfig ? (
                  <BrowserCall
                    config={view.browserConfig}
                    token={token}
                    lang={lang}
                    spokenLanguage={view.language ?? lang}
                    functionKind={view.functionKind}
                    purpose={view.purpose}
                    promptVariant={view.promptVariant}
                    onResult={refresh}
                  />
                ) : null}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function consentStatus(view: ConsentView) {
  switch (view.status) {
    case "ready": return "waiting";
    case "starting":
    case "started":
    case "browser_ready": return view.channel === "browser" ? "browser" : "ringing";
    case "result_saved":
    case "resolved": return "received";
    case "unresolved": return "unresolved";
    case "blocked":
    case "call_failed": return "unavailable";
    case "awaiting_consent": return null;
  }
}
