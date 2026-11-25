"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { isWeddingTopic } from "../wedding-topic";
import { coalesceChanges } from "./live-refresh";

type Subscription = { listeners: Set<() => void>; close: () => void };
const subscriptions = new Map<string, Subscription>();

function open(topic: string): Subscription | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const listeners = new Set<() => void>();
  const changes = coalesceChanges(() => {
    if (document.visibilityState !== "visible") return;
    for (const listener of listeners) listener();
  });
  const channel = client.channel(topic).on("broadcast", { event: "changed" }, changes.notify).subscribe();
  return {
    listeners,
    close() {
      changes.cancel();
      void client.removeChannel(channel).catch(() => {});
    },
  };
}

/** Subscribe only to a capability received with the authenticated wedding view. */
export function useWeddingLive(topic: string | null | undefined, onChange: () => void) {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!isWeddingTopic(topic)) return;
    let subscription: Subscription | undefined;
    try {
      subscription = subscriptions.get(topic) ?? open(topic);
    } catch {
      return;
    }
    if (!subscription) return;
    subscriptions.set(topic, subscription);
    const listener = () => callback.current();
    subscription.listeners.add(listener);

    return () => {
      subscription.listeners.delete(listener);
      if (subscription.listeners.size === 0) {
        subscriptions.delete(topic);
        subscription.close();
      }
    };
  }, [topic]);
}
