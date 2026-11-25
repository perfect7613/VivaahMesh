"use client";

import Script from "next/script";
import { useEffect, useState, type FormEvent } from "react";
import { VivaahMark } from "@/components/landing/BrandIcons";

type TelegramLogin = {
  auth(
    options: { client_id: number; nonce: string; scope: string[] },
    callback: (result: { id_token?: string; error?: string }) => void,
  ): void;
};

export function BrowserSignIn({ join, emailError, onSignIn }: {
  join: string | null;
  emailError: boolean;
  onSignIn: () => void;
}) {
  const [options, setOptions] = useState<{ clientId: number; nonce: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(emailError ? "That link expired or was opened in a different browser. Request a new link to try again." : "");

  useEffect(() => {
    let alive = true;
    fetch("/api/browser-auth")
      .then((res) => res.json())
      .then((data) => { if (alive && data.clientId) setOptions(data); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  function telegramSignIn() {
    const login = (window.Telegram as { Login?: TelegramLogin } | undefined)?.Login;
    if (!login || !options) return;
    setBusy(true);
    setMessage("");
    login.auth({ client_id: options.clientId, nonce: options.nonce, scope: ["profile"] }, async (result) => {
      try {
        if (!result?.id_token) throw new Error();
        const res = await fetch("/api/browser-auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: result.id_token }),
        });
        if (!res.ok) throw new Error();
        onSignIn();
      } catch {
        setMessage("Telegram sign-in could not finish. Reload to try again or use email.");
      } finally {
        setBusy(false);
      }
    });
  }

  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email");
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/browser-auth/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, join }),
      });
      if (res.status === 429) setMessage("Please wait a minute before requesting another link.");
      else if (res.ok) setMessage("Check your email and open the sign-in link in this browser.");
      else throw new Error();
    } catch {
      setMessage("We couldn’t send a link. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md place-items-center px-6 py-10">
      <div className="flex w-full flex-col gap-5 rounded-3xl border border-line bg-card p-7">
        <VivaahMark size={44} />
        <h1 className="font-display text-3xl">{join ? "Sign in to join the wedding" : "Sign in to VivaahMesh"}</h1>
        {options && <>
          <Script src="https://oauth.telegram.org/js/telegram-login.js?6" onReady={() => setReady(true)} />
          <button type="button" className="rounded-xl border border-line px-4 py-3 font-medium disabled:opacity-50"
            disabled={!ready || busy} onClick={telegramSignIn}>Continue with Telegram</button>
        </>}
        <form className="flex flex-col gap-3" onSubmit={sendLink}>
          <label className="font-medium" htmlFor="browser-email">Email address</label>
          <input className="rounded-xl border border-line bg-bg px-4 py-3" id="browser-email" name="email"
            type="email" autoComplete="email" required maxLength={254} />
          <button type="submit" className="rounded-xl bg-ink px-4 py-3 font-medium text-bg disabled:opacity-50"
            disabled={busy}>Email me a sign-in link</button>
        </form>
        {message && <p role="status" className="text-sm text-muted">{message}</p>}
      </div>
    </main>
  );
}
