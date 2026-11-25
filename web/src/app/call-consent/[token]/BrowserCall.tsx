"use client";

import { useEffect, useRef, useState } from "react";
import {
  AgentState, BrowserAudioInterface, ConversationAgent, InteractionType, type InteractionConfig,
} from "sarvam-conv-ai-sdk/browser";
import type { Lang } from "@/lib/i18n";

export interface BrowserCallConfig {
  orgId: string;
  workspaceId: string;
  appId: string;
  version?: number;
  userIdentifier: string;
}

type Phase = "idle" | "connecting" | "speaking" | "saving" | "complete" | "mic" | "connection" | "retry";
type Session = { agent: ConversationAgent; timeout?: number };
const languageName = { en: "English", hi: "Hindi", mr: "Marathi" } as const;
const text = {
  en: {
    start: "Start browser voice call", end: "End call", retry: "Try saving again",
    connecting: "Connecting to Sarvam…", speaking: "Browser voice call in progress",
    saving: "The call ended. Waiting for Sarvam to confirm the result…",
    mic: "Enable your microphone in this browser, then try again.", connection: "The browser call could not connect. Ask the family for a new link if it remains unavailable.",
    unsaved: "We could not save the call result yet. You can retry saving it here.",
    complete: "Your answer was saved.",
  },
  hi: {
    start: "ब्राउज़र में वॉइस कॉल शुरू करें", end: "कॉल खत्म करें", retry: "सेव करने की फिर कोशिश करें",
    connecting: "Sarvam से जुड़ रहे हैं…", speaking: "ब्राउज़र में वॉइस कॉल चल रही है",
    saving: "कॉल खत्म हुई। Sarvam से परिणाम की पुष्टि का इंतज़ार है…",
    mic: "इस ब्राउज़र में माइक्रोफ़ोन की अनुमति दें, फिर कोशिश करें।", connection: "ब्राउज़र कॉल जुड़ नहीं पाई। अगर कॉल उपलब्ध नहीं हो रही है, तो परिवार से नया लिंक माँगें।",
    unsaved: "कॉल का परिणाम अभी सेव नहीं हुआ। यहीं से फिर कोशिश कर सकते हैं।",
    complete: "आपका जवाब सेव हो गया।",
  },
  mr: {
    start: "ब्राउझरमध्ये व्हॉइस कॉल सुरू करा", end: "कॉल संपवा", retry: "जतन करण्याचा पुन्हा प्रयत्न करा",
    connecting: "Sarvam शी संपर्क साधत आहोत…", speaking: "ब्राउझरमध्ये व्हॉइस कॉल चालू आहे",
    saving: "कॉल संपला. Sarvam कडून निकालाची खात्री मिळण्याची प्रतीक्षा आहे…",
    mic: "या ब्राउझरमध्ये मायक्रोफोनला परवानगी द्या, मग पुन्हा प्रयत्न करा.", connection: "ब्राउझर कॉल जोडला गेला नाही. कॉल उपलब्ध होत नसेल तर कुटुंबाकडून नवीन लिंक मागा.",
    unsaved: "कॉलचा निकाल अजून जतन झाला नाही. इथून पुन्हा प्रयत्न करू शकता.",
    complete: "तुमचे उत्तर जतन झाले.",
  },
};
const buttonClass = "pressable min-h-12 w-full rounded-xl border border-marigold bg-marigold-soft px-4 py-2.5 font-semibold focus-visible:ring-2 focus-visible:ring-marigold focus-visible:ring-offset-2 focus-visible:ring-offset-card";
const resultIdPattern = /^\d{8}\/[\w-]{1,128}$/;

export function BrowserCall({ config, token, lang, spokenLanguage, functionKind, purpose, promptVariant, onResult }: {
  config: BrowserCallConfig;
  token: string;
  lang: Lang;
  spokenLanguage: Lang;
  functionKind?: string;
  purpose: string;
  promptVariant?: "baseline" | "clarify_scope" | null;
  onResult: () => void;
}) {
  const storageKey = `vm_browser_call_${config.userIdentifier}`;
  const interactionId = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>(() => readResult(storageKey) ? "retry" : "idle");
  const session = useRef<Session | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const t = text[lang];

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = session.current;
      session.current = null;
      if (current) {
        window.clearTimeout(current.timeout);
        void current.agent.stop().catch(() => {});
      }
    };
  }, []);

  async function saveResult(id: string) {
    setPhase("saving");
    try {
      for (const delay of [0, 1_000, 2_000, 4_000, 6_000]) {
        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
        if (!mounted.current) return;
        const response = await fetch(`/api/calls/consent/${encodeURIComponent(token)}/browser-result`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ interactionId: id }),
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) {
          storeResult(storageKey, null);
          if (mounted.current) {
            setPhase("complete");
            onResult();
          }
          return;
        }
        const result: { error?: string } = await response.json().catch(() => ({}));
        if (result.error !== "browser_result_pending" && response.status < 500) break;
      }
    } catch {
      // The same interaction can be sent again without opening another call.
    } finally {
      busy.current = false;
    }
    if (mounted.current) setPhase("retry");
  }

  async function finish(current: Session, error: Phase = "connection") {
    if (session.current !== current) return;
    session.current = null;
    window.clearTimeout(current.timeout);
    const id = current.agent.getInteractionId();
    await current.agent.stop().catch(() => {});
    if (!mounted.current) return;
    if (id && resultIdPattern.test(id)) {
      interactionId.current = id;
      storeResult(storageKey, id);
      await saveResult(id);
    } else {
      busy.current = false;
      setPhase(error);
    }
  }

  async function start() {
    if (busy.current) return;
    busy.current = true;
    setPhase("connecting");
    try {
      // Check microphone permission before using up the one authorized provider session.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      busy.current = false;
      if (mounted.current) setPhase("mic");
      return;
    }
    if (!mounted.current) return;

    const agent = new ConversationAgent({
      apiKey: "",
      baseUrl: "/api/calls/browser/",
      customHeaders: { "X-Call-Consent": token },
      config: {
        org_id: config.orgId,
        workspace_id: config.workspaceId,
        app_id: config.appId,
        version: config.version,
        user_identifier: config.userIdentifier,
        user_identifier_type: "custom",
        interaction_type: InteractionType.CALL,
        input_sample_rate: 16000,
        output_sample_rate: 16000,
        initial_language_name: languageName[spokenLanguage] as InteractionConfig["initial_language_name"],
        agent_variables: {
          ...(functionKind ? { wedding_function: functionKind, function_name: "Sangeet" } : {}),
          question: purpose,
          ...(promptVariant ? { caller_prompt: promptVariant } : {}),
          vivaahmesh_call_reference: config.userIdentifier,
        },
      },
      audioInterface: new BrowserAudioInterface(),
      stateCallback: (state) => {
        const id = agent.getInteractionId();
        if (state === AgentState.CONNECTED && id && session.current === current) {
          window.clearTimeout(current.timeout);
          if (resultIdPattern.test(id)) storeResult(storageKey, id);
          setPhase("speaking");
        }
      },
      endCallback: () => finish(current),
    });
    const current: Session = { agent };
    session.current = current;
    current.timeout = window.setTimeout(() => void finish(current), 15_000);
    try {
      await agent.start();
      if (session.current !== current) {
        await agent.stop().catch(() => {});
        return;
      }
      await agent.waitForDisconnect();
      await finish(current);
    } catch {
      await finish(current);
    }
  }

  function retry() {
    const id = interactionId.current ?? readResult(storageKey);
    if (!busy.current && id) {
      busy.current = true;
      void saveResult(id);
    }
  }

  switch (phase) {
    case "connecting":
    case "saving":
    case "complete":
      return <p role="status">{t[phase]}</p>;
    case "speaking":
      return (
        <div className="space-y-2">
          <p role="status">{t.speaking}</p>
          <button type="button" className={buttonClass} onClick={() => { if (session.current) void finish(session.current); }}>{t.end}</button>
        </div>
      );
    case "retry":
      return (
        <div className="space-y-2">
          <p role="alert">{t.unsaved}</p>
          <button type="button" className={buttonClass} onClick={retry}>{t.retry}</button>
        </div>
      );
    default:
      return (
        <div className="space-y-2">
          {phase !== "idle" ? <p role="alert">{t[phase]}</p> : null}
          <button type="button" className={buttonClass} onClick={() => void start()}>{t.start}</button>
        </div>
      );
  }
}

function readResult(key: string) {
  try {
    const id = sessionStorage.getItem(key);
    return id && resultIdPattern.test(id) ? id : null;
  } catch {
    return null;
  }
}

function storeResult(key: string, id: string | null) {
  try {
    if (id) sessionStorage.setItem(key, id);
    else sessionStorage.removeItem(key);
  } catch {
    // Storage is optional; the active session can still submit its result.
  }
}
