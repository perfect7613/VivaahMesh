"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { dict, isBase, isRtl, pickLang, registerDict, tr, type Lang } from "@/lib/i18n";
import { BrowserSignIn } from "@/app/tg/BrowserSignIn";
import { useInstallPrompt } from "@/app/tg/InstallPrompt";
import { OfflinePlanView } from "@/app/tg/OfflinePlanView";
import { offlineViewerKey, saveOfflinePlan, setOfflineViewer } from "@/lib/client/offline-plan";
import { ApiError, api, getWebApp, useWebApp } from "@/lib/client/telegram";
import { CreateFlow } from "./flows/CreateFlow";
import { JoinFlow } from "./flows/JoinFlow";
import { Home } from "./flows/Home";
import type { View } from "./flows/types";
import { VivaahMark } from "./landing/BrandIcons";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "signIn" }
  | { kind: "create" }
  | { kind: "join"; code: string }
  | { kind: "home"; view: View; celebrate: "created" | "joined" | null };

export function MiniApp() {
  const params = useSearchParams();
  const [state, setState] = useState<State>({ kind: "loading" });
  const webApp = useWebApp();
  const [offline, setOffline] = useState(false);
  const installPrompt = useInstallPrompt(!webApp, state.kind === "home" && !offline);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [joinedCode, setJoinedCode] = useState<string | null>(null);
  const [browserFirstName, setBrowserFirstName] = useState("");
  const [chosenLang, setLang] = useState<Lang | null>(null);
  const lang: Lang = chosenLang ?? pickLang(webApp?.initDataUnsafe.user?.language_code);
  const firstName = webApp?.initDataUnsafe.user?.first_name ?? browserFirstName;
  const [botUsername, setBotUsername] = useState("vivaah_bot");
  // Languages beyond Marathi/Hindi/English: load the GLM-translated UI once, then re-render.
  const [, setLoadedLangs] = useState(0);
  const [translating, setTranslating] = useState(false);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? "rtl" : "ltr";
    if (isBase(lang) || dict[lang]) return;
    let alive = true;
    const show = setTimeout(() => alive && setTranslating(true), 0);
    api<{ data: unknown }>(`/api/i18n?lang=${lang}`)
      .then((j) => {
        if (j?.data) registerDict(lang, j.data);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(show);
        if (!alive) return;
        setTranslating(false);
        setLoadedLangs((n) => n + 1);
      });
    return () => {
      alive = false;
    };
  }, [lang]);

  useEffect(() => {
    if (getWebApp()) return;
    const update = () => setOffline(!navigator.onLine);
    const initial = setTimeout(update, 0);
    const resume = () => { update(); setAttempt((value) => value + 1); };
    const accountChanged = (event: StorageEvent) => {
      if (event.key !== offlineViewerKey) return;
      setState({ kind: "loading" });
      setAttempt((value) => value + 1);
    };
    window.addEventListener("offline", update);
    window.addEventListener("online", resume);
    window.addEventListener("storage", accountChanged);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/tg-sw.js", { scope: "/tg" }).catch(() => {});
    }
    return () => {
      clearTimeout(initial);
      window.removeEventListener("offline", update);
      window.removeEventListener("online", resume);
      window.removeEventListener("storage", accountChanged);
    };
  }, []);

  useEffect(() => {
    if (!webApp && state.kind === "home" && !offline) saveOfflinePlan(state.view);
  }, [webApp, state, offline]);

  useEffect(() => {
    const wa = getWebApp();
    // Same palette as the website; Telegram's dark mode gets the matching night palette.
    const dark = wa ? wa.colorScheme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.scheme = dark ? "dark" : "light";
    if (wa) {
      wa.ready();
      wa.expand();
      document.documentElement.dataset.tg = "1";
      const paper = dark ? "#1a120d" : "#FBF6EC";
      wa.setHeaderColor?.(paper);
      wa.setBackgroundColor?.(paper);
    }
    // Deep-link payloads arrive as a query param (bot buttons) or start_param (t.me/bot/app?startapp=).
    const startParam = wa?.initDataUnsafe.start_param ?? "";
    const code = params.get("join") ?? (startParam.startsWith("join_") ? startParam.slice(5) : null);
    const join = code === joinedCode ? null : code;
    const weddingId = params.get("wedding") ?? undefined;

    let alive = true;
    api<{ view: View | null; botUsername?: string; firstName: string; viewerId: number }>(`/api/me${weddingId ? `?wedding=${encodeURIComponent(weddingId)}` : ""}`)
      .then(({ view, botUsername: b, firstName: name, viewerId }) => {
        if (!alive) return;
        if (!wa) {
          setOfflineViewer(viewerId);
          setBrowserFirstName(name ?? "");
        }
        if (b) setBotUsername(b);
        if (join) return setState({ kind: "join", code: join });
        if (view) {
          setLang(pickLang(view.me.language));
          return setState((previous) => ({
            kind: "home", view,
            celebrate: previous.kind === "home" && previous.view.wedding.id === view.wedding.id ? previous.celebrate : null,
          }));
        }
        setState({ kind: "create" });
      })
      .catch((error) => {
        if (!alive) return;
        if (!wa && error instanceof ApiError && error.status === 401) {
          setOfflineViewer(null);
          setState({ kind: "signIn" });
        } else {
          if (!wa && !navigator.onLine) setOffline(true);
          setState({ kind: "error", message: String(error.message) });
        }
      });
    return () => { alive = false; };
  }, [params, attempt, joinedCode]);

  // Closing mid-onboarding loses answers, so ask first.
  useEffect(() => {
    const wa = getWebApp();
    if (!wa) return;
    if (state.kind === "create" || state.kind === "join") wa.enableClosingConfirmation?.();
    else wa.disableClosingConfirmation?.();
  }, [state.kind]);

  async function signOut() {
    setSignOutFailed(false);
    try {
      const response = await fetch("/api/browser-auth", { method: "DELETE" });
      if (!response.ok) throw new Error();
      setOfflineViewer(null);
      setState({ kind: "signIn" });
    } catch {
      setSignOutFailed(true);
    }
  }

  function finishOnboarding(view: View, celebrate: "created" | "joined") {
    setState({ kind: "home", view, celebrate });
    if (celebrate === "joined") {
      if (webApp) return;
      const clean = new URL(window.location.href);
      setJoinedCode(clean.searchParams.get("join"));
      clean.searchParams.delete("join");
      clean.searchParams.delete("login");
      clean.searchParams.set("wedding", view.wedding.id);
      if (clean.href !== window.location.href) window.history.replaceState(null, "", clean);
    }
  }

  const browserControls = !webApp && (
    <div className="mx-auto max-w-md px-5 pt-3 text-right text-sm">
      <button type="button" className="underline" onClick={signOut}>Sign out</button>
      {signOutFailed && <p role="status">Couldn’t sign out. Please try again.</p>}
    </div>
  );
  const toast = translating ? (
    <div className="fixed inset-x-0 top-3 z-30 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-[14px] text-bg shadow-lg" role="status">
      {tr(lang).translating}
    </div>
  ) : null;
  if (offline && !webApp) return <OfflinePlanView />;
  if (state.kind === "signIn") {
    return <BrowserSignIn join={params.get("join")} emailError={params.get("login") === "email_error"}
      onSignIn={() => { setState({ kind: "loading" }); setAttempt((value) => value + 1); }} />;
  }
  if (state.kind === "loading") return <Splash />;
  if (state.kind === "error") {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 text-center">
        <div>
          <div className="mb-4 flex justify-center"><VivaahMark size={44} /></div>
          <p className="font-medium">
            {state.message === "unauthorized" ? "Please open VivaahMesh from Telegram (@vivaah_bot)." : "Something went wrong. Please try again."}
          </p>
        </div>
      </main>
    );
  }
  if (state.kind === "create") {
    return <>{browserControls}{toast}<CreateFlow lang={lang} setLang={setLang} firstName={firstName} onDone={(view) => finishOnboarding(view, "created")} /></>;
  }
  if (state.kind === "join") {
    return <>{browserControls}{toast}<JoinFlow code={state.code} lang={lang} setLang={setLang} firstName={firstName} onDone={(view) => finishOnboarding(view, "joined")} /></>;
  }
  return (
    <>
      {installPrompt}
      {browserControls}
      <Home
        view={state.view}
        setView={(view) => setState({ kind: "home", view, celebrate: null })}
        botUsername={botUsername}
        celebrate={state.celebrate}
        initialScreen={params.get("screen") === "call" ? "call" : undefined}
      />
    </>
  );
}

function Splash() {
  return (
    <main className="grid min-h-dvh place-items-center" aria-label="Loading">
      <span className="animate-pulse">
        <VivaahMark size={56} />
      </span>
    </main>
  );
}
