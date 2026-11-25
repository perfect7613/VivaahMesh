import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Service-role client. Server only: every route verifies the caller
 * (Telegram initData, WhatsApp bridge secret, …) before touching data.
 */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase env vars missing (see .env.example)");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
