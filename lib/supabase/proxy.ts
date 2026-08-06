import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * How long to wait for session revalidation before giving up for THIS request.
 * This middleware runs on every page load, so an unbounded wait here hangs the
 * whole app when the database is briefly slow — see the note at the getUser()
 * call in updateSession. 3s is far above a healthy call (~100ms) but well below
 * the point where a user is left staring at a frozen page.
 */
const AUTH_REVALIDATE_TIMEOUT_MS = 3000;

/** App routes that require a signed-in user. Extend this list as the app grows. */
function isProtectedPath(pathname: string): boolean {
  return pathname === "/lab" || pathname.startsWith("/lab/");
}

/**
 * Does this request carry a Supabase session at all? @supabase/ssr stores the
 * session in cookies named `sb-<project-ref>-auth-token`, chunked as `.0`, `.1`
 * when it exceeds the 4KB cookie limit — so match on the stem, not an exact name.
 *
 * The `-code-verifier` exclusion is load-bearing. Mid-signup the browser holds
 * `sb-<ref>-auth-token-code-verifier`, which satisfies both of the other tests
 * while representing the *absence* of a session — it is the half of a PKCE
 * exchange that has not happened yet. Counting it as a session sent this
 * function's callers down the full getUser() path during email confirmation,
 * which is exactly when nothing should be touching these cookies.
 */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(
      (c) =>
        c.name.startsWith("sb-") &&
        c.name.includes("auth-token") &&
        !c.name.endsWith("-code-verifier"),
    );
}

/**
 * Refreshes the Supabase session on every request and gates protected routes.
 * If a logged-out visitor tries to reach a protected app route (e.g. by typing
 * /lab in the URL), they're redirected to "/" to sign in — enforced here on the
 * server, so it can't be skipped from the client.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // No session cookie means there is nothing to refresh and nobody to look up,
  // so skip building a Supabase client entirely. This is every landing-page
  // visit, every crawler, and every share-link preview: the bulk of traffic at
  // any real scale. The gate below still holds, because no cookie means no user.
  if (!hasSessionCookie(request)) {
    if (isProtectedPath(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: getUser() revalidates the token with Supabase (getSession alone
  // trusts the cookie). Do not run code between creating the client and this call.
  //
  // But BOUND it. This middleware runs on every page request, so an unbounded
  // getUser() against a briefly-overloaded database would hang the ENTIRE app —
  // the marketing home and the sign-in page included — until it finally answered.
  // (That is exactly what took the app down during a heavy backfill.) If
  // revalidation doesn't return within AUTH_REVALIDATE_TIMEOUT_MS, we stop waiting
  // and treat the session as unverified for THIS request only. The degradation is
  // deliberately safe: a protected route then redirects to sign-in (fail closed),
  // a public route just renders, and the refresh happens on the next request. A
  // slow DB becomes "signed out for a moment," never "nothing loads."
  const user = await Promise.race([
    supabase.auth
      .getUser()
      .then((r) => r.data.user)
      .catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), AUTH_REVALIDATE_TIMEOUT_MS)),
  ]);

  if (isProtectedPath(request.nextUrl.pathname) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
