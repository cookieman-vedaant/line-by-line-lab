/**
 * Client helper for the human gate. The gate is active only when a Turnstile
 * SITE key is configured (otherwise it's off and children render straight
 * through).
 *
 * Verification is intentionally NOT persisted across page loads: the check runs
 * every time a visitor enters the Lab, re-verifying on every reload/navigation
 * (see components/HumanGate). The signed cookie the server sets still authorizes
 * that page session's API calls.
 */
export function turnstileSiteKey(): string | undefined {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined;
}
