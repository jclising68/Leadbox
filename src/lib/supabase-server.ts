import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase admin client. Uses the service_role key so it can
 * bypass RLS and call auth.admin.* methods (e.g. create users).
 *
 * Returns `null` when the env vars aren't configured — callers should
 * fall back to alternative flows (e.g. Resend for email, or console log).
 */
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      flowType: "implicit",
    },
  });
}
