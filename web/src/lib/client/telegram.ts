"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";

type Haptic = {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred(type: "error" | "success" | "warning"): void;
  selectionChanged(): void;
};
type TgButton = {
  setText(t: string): void; show(): void; hide(): void; enable(): void; disable(): void;
  showProgress(leaveActive?: boolean): void; hideProgress(): void;
  onClick(cb: () => void): void; offClick(cb: () => void): void;
  setParams?(p: Record<string, unknown>): void;
};
export interface WebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string; language_code?: string }; start_param?: string };
  colorScheme: "light" | "dark";
  platform: string;
  ready(): void; expand(): void;
  setHeaderColor?(c: string): void; setBackgroundColor?(c: string): void;
  enableClosingConfirmation?(): void; disableClosingConfirmation?(): void;
  openTelegramLink(url: string): void;
  MainButton: TgButton;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: Haptic;
}
declare global {
  interface Window { Telegram?: { WebApp?: WebApp } }
}

/** The Telegram WebApp object, or null when opened in a normal browser (PWA / local dev). */
export function getWebApp(): WebApp | null {
  if (typeof window === "undefined") return null;
  const w = window.Telegram?.WebApp;
  return w && w.initData ? w : null;
}

const subscribe = () => () => {};
export function useWebApp(): WebApp | null {
  return useSyncExternalStore(subscribe, getWebApp, () => null);
}

export const haptic = {
  tap: () => getWebApp()?.HapticFeedback?.impactOccurred("light"),
  select: () => getWebApp()?.HapticFeedback?.selectionChanged(),
  success: () => getWebApp()?.HapticFeedback?.notificationOccurred("success"),
  error: () => getWebApp()?.HapticFeedback?.notificationOccurred("error"),
};

/** Local dev outside Telegram: a stable fake identity, accepted only when DEV_AUTH_BYPASS=1 on a dev server. */
function devUser(): string {
  const k = "vm_dev_user";
  let v = localStorage.getItem(k);
  if (!v) {
    v = `${Math.floor(1e9 + Math.random() * 1e9)}:Guest`;
    localStorage.setItem(k, v);
  }
  return v;
}

/** An API error that keeps the HTTP status and the JSON body (e.g. a 409 carrying the newer plan). */
export class ApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

export const browserAuthExpired = "vivaahmesh:browser-auth-expired";

export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const wa = getWebApp();
  const form = init?.body instanceof FormData ? init.body : null;
  const headers: Record<string, string> = form ? {} : { "content-type": "application/json" };
  if (wa) headers.authorization = `tma ${wa.initData}`;
  else if (process.env.NODE_ENV !== "production") headers["x-dev-user"] = devUser();
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers,
    signal: init?.signal,
    body: form ?? (init?.body ? JSON.stringify(init.body) : undefined),
  });
  if (!wa && res.status === 401 && path.startsWith("/api/") && !path.startsWith("/api/me")) {
    window.dispatchEvent(new Event(browserAuthExpired));
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((json as { error?: string }).error ?? `HTTP ${res.status}`, res.status, json);
  return json as T;
}

/**
 * The primary action of a screen. Inside Telegram it drives the native MainButton.
 * Outside Telegram the caller renders <FallbackButton/> instead.
 */
export function useMainButton(text: string, onClick: () => void, opts: { enabled?: boolean; loading?: boolean; visible?: boolean } = {}) {
  const { enabled = true, loading = false, visible = true } = opts;
  const cb = useRef(onClick);
  useEffect(() => {
    cb.current = onClick;
  }, [onClick]);

  useEffect(() => {
    const wa = getWebApp();
    if (!wa) return;
    const mb = wa.MainButton;
    const handler = () => {
      haptic.tap();
      cb.current();
    };
    mb.onClick(handler);
    return () => mb.offClick(handler);
  }, []);

  useEffect(() => {
    const mb = getWebApp()?.MainButton;
    if (!mb) return;
    mb.setText(text);
    // Sindoor, like the website's primary button.
    mb.setParams?.({ color: "#B3261E", text_color: "#FFFFFF" });
    if (enabled) mb.enable(); else mb.disable();
    if (loading) mb.showProgress(false); else mb.hideProgress();
    if (visible) mb.show(); else mb.hide();
  }, [text, enabled, loading, visible]);

  useEffect(() => () => getWebApp()?.MainButton.hide(), []);
}

export function useBackButton(onBack: (() => void) | null) {
  const cb = useRef(onBack);
  useEffect(() => {
    cb.current = onBack;
  }, [onBack]);
  const has = !!onBack;
  useEffect(() => {
    const wa = getWebApp();
    if (!wa) return;
    const handler = () => cb.current?.();
    if (has) {
      wa.BackButton.show();
      wa.BackButton.onClick(handler);
    } else wa.BackButton.hide();
    return () => wa.BackButton.offClick(handler);
  }, [has]);
}
