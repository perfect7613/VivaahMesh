"use client";
import { useEffect, useState } from "react";
import { base, tr, type Lang } from "@/lib/i18n";
import { api, haptic, useBackButton, useMainButton } from "@/lib/client/telegram";
import { FallbackButton } from "@/components/ui";
import type { View } from "./types";

interface Preview {
  recipient: { name: string; phone: string; language: string; role: string } | null;
  purpose: string;
  callerPrompt: string;
  dialingEnabled: boolean;
  configured: boolean;
  browserEnabled: boolean;
  rehearsal?: boolean;
  lastCall: { id: string; status: string; error: string | null; processed_at: string | null;
    follow_up_count: number | null; fact: { status: string; wording: string } | null } | null;
}

/**
 * The parent sees exactly who will be called and what will be asked before anything dials
 * (PRD user story 7). After authorizing, the screen follows the call until the answer lands.
 */
export function CallScreen({ view, lang, onClose }: { view: View; lang: Lang; onClose: () => void }) {
  const t = tr(lang);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = preview?.lastCall && (!callId || preview.lastCall.id === callId) ? preview.lastCall : null;
  const done = status && (status.processed_at || ["no_answer", "failed", "blocked"].includes(status.status));

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Preview>(`/api/calls?wedding=${view.wedding.id}`)
        .then((p) => alive && setPreview(p))
        .catch((e: Error) => alive && setError(e.message));
    load();
    if (!callId || done) return () => void (alive = false);
    const id = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [view.wedding.id, callId, done]);

  useEffect(() => {
    if (status?.processed_at) haptic.success();
  }, [status?.processed_at]);

  async function authorize() {
    setBusy(true);
    try {
      if (preview?.browserEnabled) {
        const { callId, url } = await api<{ callId: string; url: string }>("/api/calls/browser-invite", {
          body: { weddingId: view.wedding.id, authorize: true },
        });
        setCallId(callId);
        setBrowserUrl(url);
        haptic.tap();
        return;
      }
      const { call } = await api<{ call: { id: string; status: string } }>("/api/calls", { body: { weddingId: view.wedding.id } });
      setCallId(call.id);
      haptic.tap();
    } catch (e) {
      setError((e as Error).message);
      haptic.error();
    } finally {
      setBusy(false);
    }
  }

  const followUpCopy = {
    en: { count: "Follow-up questions", callback: "Authorize a callback" },
    hi: { count: "अतिरिक्त सवाल", callback: "दोबारा कॉल करने की अनुमति दें" },
    mr: { count: "पुढील प्रश्न", callback: "पुन्हा कॉल करण्यास परवानगी द्या" },
  }[base(lang)];
  const browserCopy = {
    en: { authorize: "Authorize browser call", recipient: "Venue owner · browser link", share: "Share this link with the venue owner so they can consent and speak." },
    hi: { authorize: "ब्राउज़र कॉल की अनुमति दें", recipient: "वेन्यू मालिक · ब्राउज़र लिंक", share: "यह लिंक वेन्यू मालिक को भेजें ताकि वे सहमति देकर बात कर सकें।" },
    mr: { authorize: "ब्राउझर कॉलला परवानगी द्या", recipient: "कार्यक्रमस्थळाचे मालक · ब्राउझर लिंक", share: "कार्यक्रमस्थळाच्या मालकाला हा दुवा पाठवा, म्हणजे ते संमती देऊन बोलू शकतील." },
  }[base(lang)];
  const authorizeLabel = preview?.browserEnabled ? browserCopy.authorize : t.callAuthorize;
  const canAuthorize = !!preview && (preview.browserEnabled || (preview.configured && !!preview.recipient)) && !callId;
  useMainButton(callId ? t.backToPlan : authorizeLabel, callId ? onClose : authorize, { enabled: callId ? true : canAuthorize, loading: busy, visible: !!preview });
  useBackButton(onClose);

  const statusLine =
    !status ? null
    : status.status === "blocked" ? t.callStatusBlocked
    : status.processed_at ? t.callDone
    : status.status === "no_answer" ? t.callNoAnswer
    : status.status === "failed" ? t.callFailed
    : t.callDialing;

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div className="toran" />
      <main className="step-enter relative mx-auto w-full max-w-md px-5 pb-32 pt-6">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-sindoor">Sangeet · Sarvam Samvaad</p>
        <h1 className="mb-3 font-display text-[32px] leading-[1.08]">{t.callTitle}</h1>
        <p className="mb-7 text-[16px] leading-relaxed text-body">{t.callHint}</p>

        {error ? (
          <p className="mb-5 rounded-2xl border border-sindoor/40 bg-sindoor/10 px-4 py-3 text-[15px]">
            {error === "parents_or_couple_only" ? t.callOnlyParents : error === "calling_not_configured" ? t.callNotSetUp : t.callFailed}
          </p>
        ) : null}

        {preview ? (
          <>
            {preview.rehearsal && !preview.browserEnabled ? (
              <p className="mb-4 rounded-2xl border border-dashed border-marigold/70 bg-marigold-soft px-4 py-3 text-[14px]">
                🎭 Rehearsal: no phone will ring. A simulated venue answers through the same pipeline, and everything it adds is labelled as rehearsal.
              </p>
            ) : null}
            <dl className="overflow-hidden rounded-3xl border border-line bg-card">
              <Row label={t.callWho} value={preview.browserEnabled ? browserCopy.recipient : preview.recipient ? `${preview.recipient.name} · ${preview.recipient.phone}` : t.callNotSetUp} />
              <Row label={t.callAsk} value={`“${preview.purpose}”`} border />
              <Row label={t.callLanguage} value={preview.recipient?.language ?? "—"} border />
              <Row label={t.callVariant} value={preview.callerPrompt} border mono />
            </dl>

            {!preview.browserEnabled && !preview.dialingEnabled ? (
              <p className="mt-4 flex items-start gap-2 rounded-2xl border border-line bg-card px-4 py-3 text-[14px] text-body">
                <span aria-hidden>⛔</span>
                <span>
                  {t.callBlocked} <span className="text-muted">(Flagsmith · outbound_dialing_enabled)</span>
                </span>
              </p>
            ) : null}

            {browserUrl ? (
              <div className="mt-4 space-y-2 rounded-2xl border border-line bg-card p-4">
                <p>{browserCopy.share}</p>
                <input className="w-full rounded-lg border border-line px-2 py-2 text-sm" aria-label={browserCopy.share} value={browserUrl} readOnly
                  onFocus={(event) => event.currentTarget.select()} />
              </div>
            ) : null}
            {statusLine && (!browserUrl || done) ? (
              <div className="mt-6 flex items-center gap-3 rounded-3xl border border-marigold/50 bg-marigold-soft px-5 py-4" aria-live="polite">
                {!done ? (
                  <span className="relative flex size-3 shrink-0" aria-hidden>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-sindoor opacity-60" />
                    <span className="relative inline-flex size-3 rounded-full bg-sindoor" />
                  </span>
                ) : (
                  <span aria-hidden>{status?.processed_at ? "✓" : "•"}</span>
                )}
                <div>
                  <p className="font-medium">{statusLine}</p>
                  {!done ? <p className="text-[13px] text-body">{t.callDialingHint}</p> : null}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="h-48 animate-pulse rounded-3xl bg-card" />
        )}

        {status?.processed_at && status.follow_up_count !== null ? (
          <p className="mt-4 text-sm text-muted">{followUpCopy.count} · {status.follow_up_count}</p>
        ) : null}
        {status?.processed_at && status.fact?.status === "unresolved" && (preview?.configured || preview?.browserEnabled) ? (
          <button type="button" disabled={busy} onClick={() => { void authorize(); }}
            className="pressable mt-4 min-h-11 rounded-xl border border-line bg-card px-4 py-2">
            {followUpCopy.callback}
          </button>
        ) : null}

        <FallbackButton text={callId ? t.backToPlan : authorizeLabel} onClick={callId ? onClose : authorize} enabled={callId ? true : canAuthorize} loading={busy} />
      </main>
    </div>
  );
}

function Row({ label, value, border, mono }: { label: string; value: string; border?: boolean; mono?: boolean }) {
  return (
    <div className={`px-5 py-4 ${border ? "border-t border-line" : ""}`}>
      <dt className="mb-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className={`text-[16px] leading-snug ${mono ? "font-mono text-[14px]" : ""}`}>{value}</dd>
    </div>
  );
}
