/**
 * The route-gate decision, split out from the proxy so it can be tested without
 * a NextRequest, a Supabase client, or a network.
 */

/** What we managed to learn about the session on THIS request. */
export type Revalidation =
  /** Supabase confirmed a user. */
  | "signed-in"
  /** Supabase answered, and there is no valid user. */
  | "signed-out"
  /** We never got an answer: the call timed out or threw. NOT the same thing. */
  | "unknown";

export type GateDecision = "allow" | "redirect-to-signin";

/** App routes that require a signed-in user. Extend this list as the app grows. */
export function isProtectedPath(pathname: string): boolean {
  return pathname === "/lab" || pathname.startsWith("/lab/");
}

/**
 * Whether to serve the request or bounce it to sign-in.
 *
 * The load-bearing case is "unknown". Revalidation is bounded by a timeout so a
 * briefly unresponsive auth service can't hang every page in the app — but the
 * first version of that treated a timeout exactly like a confirmed logout, and
 * redirected. For a user who IS signed in, that is indistinguishable from being
 * thrown out: they land back on the marketing page, which then does its own
 * (unbounded) lookup, greets them by email, and offers a button back into the
 * Lab that can bounce them straight out again.
 *
 * So "unknown" allows the request. This is not a hole:
 *   - it is only reachable when the request already CARRIES a session cookie
 *     (the caller skips revalidation entirely when there is none),
 *   - every data route calls requireUser() itself and 401s independently — the
 *     proxy's matcher deliberately skips /api, so route auth was never relying
 *     on this gate,
 *   - and /lab's own server components render nothing for an absent user.
 *
 * A confirmed "signed-out" still fails closed, which is the case that actually
 * matters: someone typing /lab with no valid session.
 */
export function gateDecision(isProtected: boolean, revalidation: Revalidation): GateDecision {
  if (!isProtected) return "allow";
  return revalidation === "signed-out" ? "redirect-to-signin" : "allow";
}
