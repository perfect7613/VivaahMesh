"use client";

import { useEffect, useState } from "react";

interface InstallEvent extends Event {
  prompt(): Promise<unknown>;
}

const seenKey = "vm_install_hint_seen";

export function useInstallPrompt(enabled: boolean, onboarded: boolean) {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    function onPrompt(candidate: Event) {
      candidate.preventDefault();
      setEvent(candidate as InstallEvent);
    }
    function installed() {
      setHidden(true);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", installed);
    const timer = setTimeout(() => {
      const installed = matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone;
      const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      setIos(appleMobile);
      try {
        setHidden(!!installed || localStorage.getItem(seenKey) === "1");
      } catch {
        setHidden(true);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", installed);
    };
  }, [enabled]);
  const shown = enabled && onboarded && !hidden && (!!event || ios);
  useEffect(() => {
    if (shown) {
      try { localStorage.setItem(seenKey, "1"); } catch { /* storage can be disabled */ }
    }
  }, [shown]);
  if (!shown) return null;
  return (
    <aside aria-label="Install VivaahMesh" className="mx-auto flex max-w-md flex-wrap items-center gap-3 px-5 py-3 text-sm">
      {event
        ? <button type="button" className="rounded-lg bg-ink px-3 py-2 text-bg" onClick={() => {
          setHidden(true);
          void event.prompt().catch(() => {});
        }}>Install VivaahMesh</button>
        : <p>To install on iOS, open the Share menu and tap Add to Home Screen.</p>}
      <button type="button" className="underline" onClick={() => setHidden(true)}>Dismiss</button>
    </aside>
  );
}
