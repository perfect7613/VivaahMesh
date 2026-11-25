"use client";

import Script from "next/script";
import { useState } from "react";
import { MiniApp } from "@/components/MiniApp";

/** Initialize Telegram before the first authenticated API read. Bearer-link pages load independently. */
export function TelegramEntry() {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive"
        onReady={() => setLoaded(true)} onError={() => setLoaded(true)} />
      {loaded && <MiniApp />}
    </>
  );
}
