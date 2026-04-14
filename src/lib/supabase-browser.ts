import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Browser-side Supabase client (anon/public key). Singleton — safe to
 * call multiple times; only one client instance is created.
 *
 * Returns `null` when the env vars aren't set so callers can fall back
 * to legacy flows.
 */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key);
  }
  return client;
}
