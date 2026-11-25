"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { pickLang, type Lang } from "@/lib/i18n";
import { api, getWebApp, useWebApp } from "@/lib/client/telegram";
import { CreateFlow } from "./flows/CreateFlow";
import { JoinFlow } from "./flows/JoinFlow";
import { Home } from "./flows/Home";
import type { View } from "./flows/types";
import { VivaahMark } from "./landing/BrandIcons";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "create" }
  | { kind: "join"; code: string }
  | { kind: "home"; view: View; celebrate: "created" | "joined" | null };

export function MiniApp() {
  const params = useSearchParams();
  const [state, setState] = useState<State>({ kind: "loading" });
  const webApp = useWebApp();
  const [chosenLang, setLang] = useState<Lang | null>(null);
  const lang: Lang = chosenLang ?? pickLang(webApp?.initDataUnsafe.user?.language_code);
  const firstName = webApp?.initDataUnsafe.user?.first_name ?? "";
  const [botUsername, setBotUsername] = useState("vivaah_bot");

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
    const join = params.get("join") ?? (startParam.startsWith("join_") ? startParam.slice(5) : null);
    const weddingId = params.get("wedding") ?? undefined;

    api<{ view: View | null; botUsername?: string }>(`/api/me${weddingId ? `?wedding=${weddingId}` : ""}`)
      .then(({ view, botUsername: b }) => {
        if (b) setBotUsername(b);
        if (join) return setState({ kind: "join", code: join });
        if (view) {
          setLang(pickLang(view.me.language));
          return setState({ kind: "home", view, celebrate: null });
        }
        setState({ kind: "create" });
      })
      .catch((e) => setState({ kind: "error", message: String(e.message) }));
  }, [params]);

  // Closing mid-onboarding loses answers, so ask first.
  useEffect(() => {
    const wa = getWebApp();
    if (!wa) return;
    if (state.kind === "create" || state.kind === "join") wa.enableClosingConfirmation?.();
    else wa.disableClosingConfirmation?.();
  }, [state.kind]);

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
    return <CreateFlow lang={lang} setLang={setLang} firstName={firstName} onDone={(view) => setState({ kind: "home", view, celebrate: "created" })} />;
  }
  if (state.kind === "join") {
    return <JoinFlow code={state.code} lang={lang} setLang={setLang} firstName={firstName} onDone={(view) => setState({ kind: "home", view, celebrate: "joined" })} />;
  }
  return (
    <Home
      view={state.view}
      setView={(view) => setState({ kind: "home", view, celebrate: null })}
      botUsername={botUsername}
      celebrate={state.celebrate}
    />
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
