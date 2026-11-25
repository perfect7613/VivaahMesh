"use client";
import { useEffect, useRef } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
function rt() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  client ??= createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/**
 * Issue #2: run `onChange` within ~1 s of any change to this wedding on any phone. The broadcast
 * carries no data (RLS still blocks the anon key from every table); callers refetch via the API.
 * Polling stays as the fallback.
 */
export function useWeddingLive(weddingId: string | undefined, onChange: () => void) {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  }, [onChange]);
  useEffect(() => {
    const c = rt();
    if (!c || !weddingId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = c
      .channel(`wedding-${weddingId}`)
      .on("broadcast", { event: "changed" }, () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => cb.current(), 250);
      })
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      c.removeChannel(ch);
    };
  }, [weddingId]);
}
