import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Runs on every request (except static assets) to refresh the Supabase session
 * and gate protected app routes. This is what makes /lab unreachable without a
 * login, no matter how the user navigates there.
 */
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Page routes only — skip /api (routes do their own checks; avoids an auth
    // lookup on every presence ping) and Next internals / static files.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
