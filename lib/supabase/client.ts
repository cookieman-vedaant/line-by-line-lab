import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for use in Client Components (browser). Reads the public URL
 *  + anon key (safe to expose). Auth cookies are shared with the server client. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
