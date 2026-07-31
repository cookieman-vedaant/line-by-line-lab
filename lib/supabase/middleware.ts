import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** App routes that require a signed-in user. Extend this list as the app grows. */
function isProtectedPath(pathname: string): boolean {
  return pathname === "/lab" || pathname.startsWith("/lab/");
}

/**
 * Refreshes the Supabase session on every request and gates protected routes.
 * If a logged-out visitor tries to reach a protected app route (e.g. by typing
 * /lab in the URL), they're redirected to "/" to sign in — enforced here on the
 * server, so it can't be skipped from the client.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtectedPath(request.nextUrl.pathname) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
