import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * The signed-in user for an API route, resolved from the session cookie, plus
 * the Supabase client bound to that user (so every `.from(...)` query runs under
 * the user's Row-Level-Security context — they only ever touch their own rows).
 */
export type RequireUserResult =
  | { ok: true; supabase: ServerClient; user: User }
  | { ok: false; response: NextResponse };

/**
 * Gate an API route on a valid session. The proxy route-guard covers PAGE
 * routes only (its matcher skips `/api`), so each data route must check auth
 * itself — otherwise `/api/rounds` etc. would be an open door even though `/lab`
 * isn't. Returns the user + client, or a ready-to-return 401.
 *
 *   const auth = await requireUser();
 *   if (!auth.ok) return auth.response;
 *   // ...use auth.user / auth.supabase
 */
export async function requireUser(): Promise<RequireUserResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Please sign in to continue." }, { status: 401 }),
    };
  }
  return { ok: true, supabase, user };
}
