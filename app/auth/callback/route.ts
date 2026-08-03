import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safeNext";

/**
 * Legacy landing route for email links. Confirmation now lands on /auth/confirm;
 * this exists because links already sitting in inboxes point here, and it has to
 * keep working for as long as those links are alive.
 *
 * It forwards rather than exchanging. Doing the exchange here was the bug: a
 * route handler can only ever see the query string, and Supabase delivers the
 * credential as `#access_token=…` in some configurations. A fragment is never
 * transmitted to a server, so those links could not have been made to work here
 * at any amount of effort — they failed as "expired" when nothing had expired.
 * PKCE `?code=` had a second, subtler failure: it needs the verifier cookie set
 * by the browser that signed up, so opening the mail on a phone failed too.
 *
 * Forwarding fixes both. The query rides along explicitly, and the browser
 * carries the fragment across a redirect whose Location has none of its own — so
 * /auth/confirm, running on the client, can finally see every shape.
 */
export function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  // Prefer the public host behind Vercel's proxy so we don't bounce the user to
  // an internal deployment URL.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const base =
    process.env.NODE_ENV === "development" || !forwardedHost
      ? origin
      : `https://${forwardedHost}`;

  // Which shapes arrived, never their values — these are single-use credentials.
  // Without this every failure looked identical, and there was no way to tell a
  // spent token from a fragment we structurally could not read.
  console.info("[auth/callback] forwarding", {
    hasCode: searchParams.has("code"),
    hasTokenHash: searchParams.has("token_hash"),
    type: searchParams.get("type"),
    hasError: searchParams.has("error") || searchParams.has("error_description"),
  });

  // Normalise `next` HERE rather than trusting the downstream page to do it, so
  // an attacker-supplied destination never survives even one hop.
  const forwarded = new URLSearchParams(searchParams);
  forwarded.set("next", safeNext(forwarded.get("next")));

  return NextResponse.redirect(`${base}/auth/confirm?${forwarded.toString()}`);
}
