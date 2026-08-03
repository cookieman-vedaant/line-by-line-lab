// Poison pill: importing this module from a Client Component is now a BUILD
// ERROR, not a silent leak. Without it, "never import this in client code" was
// only a comment — one `"use client"` file importing this would have bundled a
// master key into JavaScript served to every visitor. This is the guard that
// makes the rule mechanical.
import "server-only";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the **service_role** key. It BYPASSES
 * Row-Level Security, so it can read across every user's rows.
 *
 * Use it ONLY for work that genuinely needs to cross the RLS boundary and whose
 * result is safe to expose — e.g. counting how many people are online (the
 * NUMBER leaves the server, never who), or deleting an auth user on request.
 * NEVER return its rows to the browser wholesale.
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
