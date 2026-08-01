import { type SupabaseClient, createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the **service_role** key. It BYPASSES
 * Row-Level Security, so it can read across every user's rows.
 *
 * Use it ONLY for aggregate, privacy-preserving reads where the *number* matters
 * but *who* must never leave the server — e.g. counting how many people are
 * online. NEVER return its rows to the browser, and NEVER import it into client
 * code (the service_role key is a master key).
 */
let cached: SupabaseClient | null = null;

export function createSupabaseAdminClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase admin client needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  // No session persistence/refresh — this is a stateless server client.
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
