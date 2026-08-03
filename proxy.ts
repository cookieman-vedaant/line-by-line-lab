import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Runs on every request (except static assets) to refresh the Supabase session
 * and gate protected app routes. This is what makes /lab unreachable without a
 * login, no matter how the user navigates there.
 *
 * Formerly `middleware.ts`. Next 16 renamed the convention to `proxy` and pinned
 * it to the Node.js runtime — `export const runtime` is an error here, not an
 * option. Everything else is unchanged: same NextRequest, same matcher, same
 * NextResponse API.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Page routes only — skip /api (routes do their own checks; avoids an auth
    // lookup on every presence ping) and Next internals / static files.
    //
    // /auth and /reset-password are excluded for a different and more important
    // reason: they are where an email link LANDS, carrying a one-time token that
    // has not been exchanged for a session yet. Running session refresh there
    // means building a Supabase client and calling getUser() with no valid
    // session, and @supabase/ssr may respond by clearing the auth cookies — the
    // PKCE code verifier among them — before the handler can spend the token.
    // Nothing may touch cookies between the click and the exchange.
    // Anchored: `api/` not `api`, so a future /apiary or /authors keeps its gate
    // instead of silently losing it to a prefix match.
    "/((?!api/|auth/|reset-password$|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
