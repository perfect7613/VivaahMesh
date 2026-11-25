"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/client/telegram";
import { recordVoiceClip, type VoiceRecording } from "@/lib/client/voice-recording";
import { requirementLabel, type FamilyRequirement, type FamilyRequirementKind } from "@/lib/family-plan";
import type { Lang } from "@/lib/i18n";
import { inputClass } from "@/components/ui";

const text = {
  en: {
    title: "Sangeet family decisions", empty: "Shared requirements will appear here after a family publishes them.",
    dinner: "Dinner start", dance: "Dance duration in minutes", note: "Reviewed note", original: "Original note", publish: "Share with both families",
    prepared: "Use prepared Marathi example", seed: "Prepared example", dictate: "Dictated and reviewed",
    record: "Record a Marathi note", stop: "Finish recording", upload: "Upload a Marathi audio clip",
    review: "Check the transcript and dinner time before sharing.", error: "Could not complete that action. Try again.",
    changed: "Another person updated this requirement. Reopen the form to see their change.",
    edit: "Edit your household’s requirement", play: "Listen to the approved recap", busy: "Working…", cancel: "Cancel",
  },
  mr: {
    title: "संगीताचे कौटुंबिक निर्णय", empty: "कुटुंबाने शेअर केल्यानंतर सूचना इथे दिसतील.",
    dinner: "जेवण सुरू होण्याची वेळ", dance: "नृत्याचा कालावधी (मिनिटे)", note: "तपासलेली नोंद", original: "मूळ नोंद", publish: "दोन्ही कुटुंबांशी शेअर करा",
    prepared: "तयार मराठी उदाहरण वापरा", seed: "तयार उदाहरण", dictate: "बोलून लिहिलेली व तपासलेली नोंद",
    record: "मराठी नोंद रेकॉर्ड करा", stop: "रेकॉर्डिंग थांबवा", upload: "मराठी ऑडिओ अपलोड करा",
    review: "शेअर करण्याआधी मजकूर आणि जेवणाची वेळ तपासा.", error: "हे काम पूर्ण झाले नाही. पुन्हा प्रयत्न करा.",
    changed: "दुसऱ्या व्यक्तीने सूचना बदलली आहे. नवीन माहिती पाहण्यासाठी फॉर्म पुन्हा उघडा.",
    edit: "आपल्या कुटुंबाची सूचना बदला", play: "मंजूर वेळापत्रक ऐका", busy: "प्रक्रिया सुरू आहे…", cancel: "रद्द करा",
  },
  hi: {
    title: "संगीत के पारिवारिक निर्णय", empty: "परिवार के साझा करने पर आवश्यकताएँ यहाँ दिखेंगी।",
    dinner: "रात के खाने का समय", dance: "नृत्य की अवधि (मिनट)", note: "जाँचा हुआ नोट", original: "मूल नोट", publish: "दोनों परिवारों से साझा करें",
    prepared: "तैयार मराठी उदाहरण इस्तेमाल करें", seed: "तैयार उदाहरण", dictate: "बोलकर लिखा और जाँचा गया नोट",
    record: "मराठी नोट रिकॉर्ड करें", stop: "रिकॉर्डिंग रोकें", upload: "मराठी ऑडियो अपलोड करें",
    review: "साझा करने से पहले नोट और खाने का समय जाँचें।", error: "यह काम पूरा नहीं हुआ। फिर से कोशिश करें।",
    changed: "किसी और ने यह आवश्यकता अपडेट की है। बदलाव देखने के लिए फ़ॉर्म फिर खोलें।",
    edit: "अपने परिवार की आवश्यकता बदलें", play: "मंज़ूर समय-सारणी सुनें", busy: "प्रक्रिया चल रही है…", cancel: "रद्द करें",
  },
} satisfies Record<Lang, Record<string, string>>;

type VoiceView = {
  requirements: FamilyRequirement[];
  canEdit: FamilyRequirementKind | null;
  prepared: { note: string; value: number } | null;
  recapRevision: number | null;
};

type Draft = {
  note: string;
  value: string;
  version: number;
  provenance?: { source: "seed" } | { draftToken: string };
};

const buttonClass = "pressable min-h-11 rounded-xl border border-line bg-card px-3 py-2 text-sm font-semibold disabled:opacity-50";
const primaryClass = "pressable min-h-11 rounded-xl bg-sindoor px-3 py-2 text-sm font-semibold text-white disabled:opacity-50";

function formValue(kind: FamilyRequirementKind, value: number) {
  return kind === "dance_duration" ? String(value) : `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function parsedValue(kind: FamilyRequirementKind, value: string) {
  if (kind === "dance_duration") {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 180 ? number : null;
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function FamilyVoice({ weddingId, lang }: { weddingId: string; lang: Lang }) {
  const t = text[lang];
  const [view, setView] = useState<VoiceView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [audio, setAudio] = useState<{ revision: number; url: string } | null>(null);
  const recorder = useRef<VoiceRecording | null>(null);
  const recorderGeneration = useRef(0);
  const fallback = useRef(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (document.visibilityState === "visible") {
        try {
          const next = await api<VoiceView>(`/api/family-voice?wedding=${encodeURIComponent(weddingId)}`);
          if (active) setView(next);
        } catch {
          // Keep the last successful projection during temporary network failure.
        }
      }
      if (active) timer = setTimeout(load, 5000);
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [weddingId]);

  useEffect(() => () => {
    recorderGeneration.current++;
    recorder.current?.cancel();
  }, []);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url); }, [audio]);

  const editable = view?.canEdit ?? null;
  const current = view?.requirements.find((item) => item.kind === editable && item.functionKind === "sangeet");
  const value = draft && editable ? parsedValue(editable, draft.value) : null;

  function openDraft() {
    setError("");
    setDraft({ value: current && editable ? formValue(editable, current.value) : "", note: current?.note ?? "", version: current?.version ?? 0 });
  }

  async function dictate(file: File) {
    const form = new FormData();
    form.set("audio", file);
    form.set("language", "mr");
    form.set("weddingId", weddingId);
    const result = await api<{ text: string; draftToken: string }>("/api/family-voice/dictate", { body: form });
    setDraft((previous) => previous && {
      ...previous,
      note: result.text,
      provenance: { draftToken: result.draftToken },
    });
  }

  async function record() {
    if (recorder.current) {
      recorder.current.stop();
      return;
    }
    const generation = ++recorderGeneration.current;
    setError("");
    setBusy(true);
    try {
      const active = await recordVoiceClip();
      if (generation !== recorderGeneration.current) { active.cancel(); return; }
      recorder.current = active;
      setRecording(true);
      const file = await active.audio;
      recorder.current = null;
      if (generation !== recorderGeneration.current) return;
      setRecording(false);
      if (file) await dictate(file);
    } catch {
      if (generation === recorderGeneration.current) setError(t.error);
    } finally {
      if (generation === recorderGeneration.current) {
        setRecording(false);
        setBusy(false);
      }
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try { await dictate(file); } catch { setError(t.error); } finally { setBusy(false); }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !editable || value === null || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ requirements: FamilyRequirement[] }>("/api/family-voice", { body: {
        weddingId, functionKind: "sangeet", kind: editable, value, note: draft.note,
        expectedVersion: draft.version, ...draft.provenance,
      } });
      setView((prev) => prev && { ...prev, requirements: result.requirements });
      setDraft(null);
    } catch (error) {
      setError(error instanceof Error && error.message === "requirement_changed" ? t.changed : t.error);
    } finally { setBusy(false); }
  }

  async function play(revision: number) {
    setBusy(true);
    setError("");
    const request = ++fallback.current;
    try {
      const result = await api<{ audio: string; revision: number }>("/api/family-voice/recap", { body: { weddingId, revision } });
      const bytes = Uint8Array.from(atob(result.audio), (char) => char.charCodeAt(0));
      if (request === fallback.current) setAudio({ revision: result.revision, url: URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })) });
    } catch { setError(t.error); } finally { setBusy(false); }
  }

  if (!view) return null;

  return (
    <section aria-labelledby="family-voice-title" className="flex flex-col gap-3 rounded-3xl border border-line bg-card px-5 py-4">
      <h2 id="family-voice-title" className="font-display text-xl">{t.title}</h2>
      {view.requirements.length ? (
        <ul className="flex flex-col divide-y divide-line" aria-live="polite">
          {view.requirements.map((item) => (
            <li key={item.id} className="py-2">
              <p className="font-medium">{requirementLabel(item, lang)}</p>
              {(item.author || item.source !== "typed") ? (
                <p className="text-sm text-muted">{[item.author, item.source === "seed" ? t.seed : item.source === "dictate" ? t.dictate : null].filter(Boolean).join(" · ")}</p>
              ) : null}
              {item.note ? (
                <details className="text-sm text-muted">
                  <summary className="min-h-10 cursor-pointer content-center">{t.original}</summary>
                  <p dir="auto" className="pb-1">{item.note}</p>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">{t.empty}</p>}
      {editable && !draft ? <button type="button" className={buttonClass} onClick={openDraft}>{t.edit}</button> : null}
      {editable && draft ? (
        <form className="flex flex-col gap-3" onSubmit={publish}>
          {editable === "dinner_start" ? (
            <div className="flex flex-col gap-2">
              <button type="button" className={buttonClass} disabled={busy && !recording} onClick={() => { void record(); }}>
                {recording ? t.stop : t.record}
              </button>
              <label className="flex flex-col gap-1 text-sm font-medium">{t.upload}
                <input className={inputClass} type="file" accept="audio/*,.webm" disabled={busy} onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void upload(file);
                }} />
              </label>
              {view.prepared ? <button type="button" disabled={busy} className={buttonClass} onClick={() => {
                if (!view.prepared) return;
                setDraft({ ...draft, note: view.prepared.note, value: formValue("dinner_start", view.prepared.value), provenance: { source: "seed" } });
              }}>{t.prepared}</button> : null}
              <p className="text-sm text-muted">{t.review}</p>
            </div>
          ) : null}
          <label className="flex flex-col gap-1 text-sm font-medium">
            {editable === "dinner_start" ? t.dinner : t.dance}
            <input className={inputClass} type={editable === "dinner_start" ? "time" : "number"} min={editable === "dance_duration" ? 1 : undefined}
              max={editable === "dance_duration" ? 180 : undefined} step={editable === "dance_duration" ? 1 : 60} required
              value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.currentTarget.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">{t.note}
            <textarea className={inputClass} maxLength={1000} rows={3} lang={editable === "dinner_start" ? "mr" : lang}
              value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.currentTarget.value })} />
          </label>
          <button type="submit" className={primaryClass} disabled={busy || value === null}>{t.publish}</button>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => { setDraft(null); setError(""); }}>{t.cancel}</button>
        </form>
      ) : null}
      {view.recapRevision !== null ? (
        <div className="flex flex-col gap-2">
          {audio?.revision === view.recapRevision ? (
            <audio src={audio.url} controls aria-label={t.play} className="w-full" />
          ) : <button type="button" className={buttonClass} disabled={busy} onClick={() => { void play(view.recapRevision!); }}>{t.play}</button>}
        </div>
      ) : null}
      {busy && !recording ? <p role="status" className="text-sm text-muted">{t.busy}</p> : null}
      {error ? <p role="alert" className="text-sm text-sindoor">{error}</p> : null}
    </section>
  );
}
