import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where email confirmation (and later OAuth) links land. Supabase redirects here
 * after the user clicks the confirm link; we establish the session (server-side,
 * so it's set as cookies) and send them into the app. Handles both flows:
 *  - PKCE `?code=...`         → exchangeCodeForSession
 *  - OTP  `?token_hash&type`  → verifyOtp (works even on a different device)
 *
 * NOTE: for the confirm link to point HERE (and not localhost), the Supabase
 * project's Site URL + Redirect URLs must include the production domain.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/lab";

  // Prefer the public host behind Vercel's proxy so we don't redirect to an
  // internal deployment URL.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const base =
    process.env.NODE_ENV === "development" || !forwardedHost
      ? origin
      : `https://${forwardedHost}`;

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${base}${next}`);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${base}${next}`);
  }

  return NextResponse.redirect(
    `${base}/?error=${encodeURIComponent(
      "That confirmation link didn't work — it may have expired. Try signing in, or sign up again.",
    )}`,
  );
}
