"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { inputClass } from "@/components/ui";
import { recordVoiceClip, type VoiceRecording } from "@/lib/client/voice-recording";
import { isBase, LANGS, type BaseLang } from "@/lib/i18n";
import { formatVenueTime } from "@/lib/venue-time";

type View = { status: "open" | "confirmed" | "withdrawn"; artist: string; readyBy: number; functionKind: string };
type Draft = { text: string; voiceDraftToken: string };
type Phase = "opening" | "recording" | "transcribing" | "saving";

const text = {
  en: {
    title: "Confirm the makeup time", language: "Your language", loading: "Checking the requested time…",
    expired: "This reply link has expired or is unavailable. Ask the family for a new link.",
    readFailed: "Could not load the request.", retry: "Try again",
    question: (artist: string, time: string) => `${artist}, can you finish makeup by ${time}?`,
    yes: "Yes, I can finish by then", no: "No, I can’t finish by then",
    reply: "Your reply", start: "Record a voice reply", stop: "Finish recording",
    opening: "Opening the microphone…", recording: "Recording · up to 30 seconds",
    transcribing: "Transcribing your reply…", saving: "Saving your reply…",
    voice: "Review the transcript. It will be shared with both families as a voice reply. Editing it changes the source to typed.",
    typed: "Both families will be able to read your typed reply.",
    recordFailed: "Could not record audio. Check microphone permission or type your reply.",
    transcribeFailed: "Could not transcribe the recording. You can record again or type your reply.",
    saveFailed: "Could not save your reply. Please try again.",
    send: "Send reply", confirmed: "You confirmed the time. Both families can see your reply.",
    withdrawn: "Your reply was saved. Both families can see that the earlier option is unavailable.",
  },
  hi: {
    title: "मेकअप का समय पक्का करें", language: "आपकी भाषा", loading: "मेकअप का समय देख रहे हैं…",
    expired: "यह लिंक उपलब्ध नहीं है या इसकी समय-सीमा पूरी हो गई है। परिवार से नया लिंक माँगें।",
    readFailed: "अनुरोध लोड नहीं हुआ।", retry: "फिर कोशिश करें",
    question: (artist: string, time: string) => `${artist}, क्या आप ${time} तक मेकअप पूरा कर सकती हैं?`,
    yes: "हाँ, मैं तब तक पूरा कर सकती हूँ", no: "नहीं, मैं तब तक पूरा नहीं कर सकती",
    reply: "आपका जवाब", start: "बोलकर जवाब रिकॉर्ड करें", stop: "रिकॉर्डिंग पूरी करें",
    opening: "माइक्रोफ़ोन खुल रहा है…", recording: "रिकॉर्डिंग चल रही है · 30 सेकंड तक",
    transcribing: "आपका जवाब लिख रहे हैं…", saving: "जवाब सेव हो रहा है…",
    voice: "लिखा हुआ जवाब जाँचें। दोनों परिवार इसे आवाज़ से दिया गया जवाब देखेंगे। बदलाव करने पर यह लिखा हुआ जवाब माना जाएगा।",
    typed: "दोनों परिवार आपका लिखा हुआ जवाब पढ़ सकेंगे।",
    recordFailed: "आवाज़ रिकॉर्ड नहीं हुई। माइक्रोफ़ोन की अनुमति जाँचें या जवाब लिखें।",
    transcribeFailed: "रिकॉर्डिंग से जवाब नहीं लिख पाए। फिर रिकॉर्ड करें या जवाब लिखें।",
    saveFailed: "जवाब सेव नहीं हुआ। फिर कोशिश करें।",
    send: "जवाब भेजें", confirmed: "आपने समय पक्का कर दिया। दोनों परिवार आपका जवाब देख सकते हैं।",
    withdrawn: "जवाब सेव हो गया। दोनों परिवार देख सकते हैं कि पहले वाला विकल्प उपलब्ध नहीं है।",
  },
  mr: {
    title: "मेकअपची वेळ निश्चित करा", language: "तुमची भाषा", loading: "विचारलेली वेळ तपासत आहोत…",
    expired: "ही लिंक उपलब्ध नाही किंवा तिची मुदत संपली आहे. कुटुंबाकडून नवीन लिंक मागा.",
    readFailed: "विनंती लोड झाली नाही.", retry: "पुन्हा प्रयत्न करा",
    question: (artist: string, time: string) => `${artist}, तुम्ही ${time} पर्यंत मेकअप पूर्ण करू शकता का?`,
    yes: "हो, मी त्या वेळेपर्यंत पूर्ण करू शकते", no: "नाही, मी त्या वेळेपर्यंत पूर्ण करू शकत नाही",
    reply: "तुमचे उत्तर", start: "आवाजात उत्तर रेकॉर्ड करा", stop: "रेकॉर्डिंग पूर्ण करा",
    opening: "मायक्रोफोन सुरू होत आहे…", recording: "रेकॉर्डिंग सुरू आहे · ३० सेकंदांपर्यंत",
    transcribing: "तुमचे उत्तर लिहून घेत आहोत…", saving: "तुमचे उत्तर जतन होत आहे…",
    voice: "लिहून घेतलेले उत्तर तपासा. दोन्ही कुटुंबांना ते आवाजात दिलेले उत्तर म्हणून दिसेल. बदल केल्यास ते लिहिलेले उत्तर म्हणून नोंदले जाईल.",
    typed: "तुम्ही लिहिलेले उत्तर दोन्ही कुटुंबांना वाचता येईल.",
    recordFailed: "आवाज रेकॉर्ड झाला नाही. मायक्रोफोनची परवानगी तपासा किंवा उत्तर लिहा.",
    transcribeFailed: "रेकॉर्डिंगमधून उत्तर लिहून घेता आले नाही. पुन्हा रेकॉर्ड करा किंवा उत्तर लिहा.",
    saveFailed: "तुमचे उत्तर जतन झाले नाही. पुन्हा प्रयत्न करा.",
    send: "उत्तर पाठवा", confirmed: "तुम्ही वेळ निश्चित केली. दोन्ही कुटुंबांना तुमचे उत्तर दिसेल.",
    withdrawn: "तुमचे उत्तर जतन झाले. आधीचा पर्याय उपलब्ध नाही हे दोन्ही कुटुंबांना दिसेल.",
  },
};
const focus = "focus-visible:ring-2 focus-visible:ring-marigold focus-visible:ring-offset-2 focus-visible:ring-offset-card";
const button = `pressable min-h-12 w-full rounded-xl border border-line px-4 py-3 font-semibold disabled:opacity-50 ${focus}`;

export function MakeupReply({ token }: { token: string }) {
  const [lang, setLang] = useState<BaseLang>("en");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<"expired" | "readFailed" | "recordFailed" | "transcribeFailed" | "saveFailed" | null>(null);
  const [confirms, setConfirms] = useState<boolean | null>(null);
  const [wording, setWording] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const active = useRef(false);
  const working = useRef(false);
  const recording = useRef<VoiceRecording | null>(null);
  const endpoint = `/api/calls/makeup/${encodeURIComponent(token)}`;
  const t = text[lang];

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      if (!active.current || signal?.aborted) return;
      if (response.status === 404 || response.status === 410) {
        setError("expired");
        setView(null);
      } else if (response.ok) {
        const data: View = await response.json();
        if (!active.current || signal?.aborted) return;
        setView(data);
        setError(null);
      } else {
        setError("readFailed");
      }
    } catch {
      if (active.current && !signal?.aborted) setError("readFailed");
    }
  }, [endpoint]);

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal);
    });
    return () => {
      active.current = false;
      controller.abort();
      recording.current?.cancel();
    };
  }, [load]);

  async function record() {
    if (working.current) return;
    working.current = true;
    setPhase("opening");
    setError(null);
    let failure: "recordFailed" | "transcribeFailed" = "recordFailed";
    try {
      const current = await recordVoiceClip();
      if (!active.current) {
        current.cancel();
        return;
      }
      recording.current = current;
      setPhase("recording");
      const audio = await current.audio;
      if (!audio || !active.current) return;
      failure = "transcribeFailed";
      setPhase("transcribing");
      const form = new FormData();
      form.append("audio", audio);
      form.append("language", lang);
      const response = await fetch(`${endpoint}/dictate`, {
        method: "POST", body: form, signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error("dictate_failed");
      const next: Draft = await response.json();
      if (!next.text || next.text.length > 1000 || !next.voiceDraftToken) throw new Error("invalid_draft");
      if (active.current) {
        setWording(next.text);
        setDraft(next);
      }
    } catch {
      if (active.current) setError(failure);
    } finally {
      working.current = false;
      recording.current = null;
      if (active.current) setPhase(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirms === null || !wording.trim() || working.current) return;
    working.current = true;
    setPhase("saving");
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirms, wording,
          ...(draft?.text === wording ? { voiceDraftToken: draft.voiceDraftToken } : {}),
        }),
      });
      if (response.status === 404 || response.status === 409 || response.status === 410) {
        await load();
        return;
      }
      if (!response.ok) throw new Error("save_failed");
      const { status }: Pick<View, "status"> = await response.json();
      setView((current) => current ? { ...current, status } : current);
    } catch {
      setError("saveFailed");
    } finally {
      working.current = false;
      setPhase(null);
    }
  }

  return (
    <main lang={lang} className="mx-auto min-h-dvh w-full max-w-md space-y-4 px-5 pt-8 pb-12">
      <header className="space-y-2">
        <p className="font-display text-lg">VivaahMesh</p>
        <h1 className="font-display text-3xl leading-tight">{t.title}</h1>
      </header>
      <label className="block space-y-1.5 font-medium">
        <span>{t.language}</span>
        <select disabled={!!phase} value={lang} className={inputClass} onChange={(event) => setLang(event.target.value as BaseLang)}>
          {LANGS.filter((option) => isBase(option.code)).map((option) => <option key={option.code} value={option.code} lang={option.code}>{option.label}</option>)}
        </select>
      </label>
      <section className="space-y-4 rounded-2xl border border-line bg-card p-4">
        {error ? <p role="alert">{t[error]}</p> : null}
        {!view && error === "readFailed" ? <button className={button} type="button" onClick={() => void load()}>{t.retry}</button> : null}
        {!view && !error ? <div className="space-y-2" role="status"><p>{t.loading}</p><div className="h-16 rounded-xl bg-line" aria-hidden="true" /></div> : null}
        {view?.status === "open" ? (
          <form className="space-y-4" onSubmit={save} aria-busy={!!phase}>
            <fieldset className="space-y-2" disabled={!!phase}>
              <legend className="mb-2 text-lg font-semibold">{t.question(view.artist, formatVenueTime(view.readyBy, lang))}</legend>
              {[true, false].map((answer) => (
                <label key={String(answer)} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line p-3">
                  <input
                    type="radio" name="makeup-answer" checked={confirms === answer} required
                    className={`size-5 shrink-0 accent-marigold ${focus}`} onChange={() => setConfirms(answer)}
                  />
                  <span>{answer ? t.yes : t.no}</span>
                </label>
              ))}
            </fieldset>
            <button
              type="button" className={button} disabled={phase !== null && phase !== "recording"}
              onClick={() => phase === "recording" ? recording.current?.stop() : void record()}
            >
              {phase === "recording" ? t.stop : t.start}
            </button>
            {phase && phase !== "saving" ? <p role="status">{t[phase]}</p> : null}
            <label className="block space-y-1.5">
              <span className="font-medium">{t.reply}</span>
              <textarea
                className={`${inputClass} min-h-28`} maxLength={1000} required disabled={!!phase}
                value={wording} aria-describedby="makeup-source"
                onChange={(event) => {
                  const value = event.target.value;
                  setWording(value);
                  if (draft && value !== draft.text) setDraft(null);
                }}
              />
            </label>
            <p id="makeup-source" className="text-sm">{draft ? t.voice : t.typed}</p>
            <button type="submit" className={`${button} border-marigold bg-marigold-soft`} disabled={!!phase || confirms === null || !wording.trim()}>
              {phase === "saving" ? t.saving : t.send}
            </button>
          </form>
        ) : null}
        {view && view.status !== "open" ? <p className="rounded-xl bg-marigold-soft p-3" role="status">{t[view.status]}</p> : null}
      </section>
    </main>
  );
}
