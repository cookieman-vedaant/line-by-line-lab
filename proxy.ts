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
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
