import "server-only";
import { createHash } from "node:crypto";
import { rateLimitShared } from "@/lib/apiRateLimit";

/**
 * Abuse limits for the email-sending auth flows (sign-up, confirmation resend,
 * password reset).
 *
 * WHY A SEPARATE MODULE FROM apiGuard: those calls run in the BROWSER, straight
 * from `@supabase/ssr` to Supabase's auth endpoints. Our API routes never see
 * them, so `guardApi` cannot limit them. The AuthForm calls this preflight
 * first, which gives us per-email and per-IP ceilings, an audit trail, and an
 * auto-ban trigger on the pattern that actually matters: one address minting
 * dozens of throwaway accounts.
 *
 * HONEST LIMITATION — read before trusting this: because the anon key is public,
 * an attacker can skip our UI and POST directly to Supabase, where this code
 * never runs. Two layers cover that, and BOTH are dashboard settings, not code:
 *   1. Supabase Auth → Settings → enable CAPTCHA protection (Turnstile). This
 *      enforces at Supabase's edge for every client, ours or not. It is the
 *      authoritative defense; treat this module as the UX-and-telemetry layer
 *      in front of it.
 *   2. Supabase Auth → Rate Limits — lower the per-hour email cap from the
 *      default to something matching real usage.
 * See supabase/README.md for the checklist.
 */

export const AUTH_ATTEMPT_KINDS = ["signup", "resend", "reset"] as const;
export type AuthAttemptKind = (typeof AUTH_ATTEMPT_KINDS)[number];

interface Limit {
  /** Max attempts in the window. */
  max: number;
  /** Window length in seconds. */
  windowSec: number;
}

interface KindLimits {
  perEmail: Limit;
  perIpHour: Limit;
  perIpDay: Limit;
  /** Attempts/day from one IP that trigger an automatic temporary ban. */
  banThresholdPerDay: number;
}

const HOUR = 3600;
const DAY = 86_400;

/**
 * Tuned for a real debater, not a bot. A person signs up once; two or three
 * attempts covers a typo and a retry. Resend is more forgiving because a missing
 * email is genuinely frustrating and the user has no other recourse. The per-IP
 * day caps are the ones that stop account farming, and they're set well above
 * a shared school network's honest usage.
 */
const LIMITS: Record<AuthAttemptKind, KindLimits> = {
  signup: {
    perEmail: { max: 3, windowSec: DAY },
    perIpHour: { max: 5, windowSec: HOUR },
    perIpDay: { max: 12, windowSec: DAY },
    banThresholdPerDay: 40,
  },
  resend: {
    perEmail: { max: 5, windowSec: HOUR },
    perIpHour: { max: 10, windowSec: HOUR },
    perIpDay: { max: 30, windowSec: DAY },
    banThresholdPerDay: 80,
  },
  reset: {
    perEmail: { max: 4, windowSec: HOUR },
    perIpHour: { max: 8, windowSec: HOUR },
    perIpDay: { max: 20, windowSec: DAY },
    banThresholdPerDay: 60,
  },
};

/**
 * Hash the email before it becomes a rate-limit key. The counters live in
 * Upstash — a third-party store — and a raw address there would be PII we never
 * disclosed and don't need. A salted digest counts just as well as the plaintext.
 * Salt falls back to a constant so the limiter still works without extra config;
 * set AUTH_HASH_SALT in production so the digests aren't guessable from a
 * known address.
 */
export function emailKey(email: string): string {
  const salt = process.env.AUTH_HASH_SALT || "lbl-auth-abuse";
  return createHash("sha256")
    .update(`${salt}:${email.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

export interface AttemptDecision {
  allowed: boolean;
  /** User-facing message when blocked. Deliberately vague about which limit hit. */
  error?: string;
  /** True when this attempt crossed the auto-ban threshold. */
  shouldBan?: boolean;
  /** Which limit tripped — for the audit log, never shown to the user. */
  tripped?: "email" | "ip-hour" | "ip-day";
}

/**
 * Check (and consume) one auth attempt. Returns whether to proceed.
 *
 * Order matters: the per-email check runs first so a user retrying their OWN
 * address gets the specific "wait a bit" path, and one person hammering one
 * address can't burn the shared IP budget for everyone behind a school NAT.
 */
export async function checkAuthAttempt(
  kind: AuthAttemptKind,
  email: string,
  ip: string,
): Promise<AttemptDecision> {
  const limits = LIMITS[kind];
  const ek = emailKey(email);

  const perEmail = await rateLimitShared(`auth:${kind}:e:${ek}`, limits.perEmail.max, limits.perEmail.windowSec);
  if (!perEmail.allowed) {
    return {
      allowed: false,
      tripped: "email",
      error:
        kind === "signup"
          ? "Too many sign-up attempts for that email. Try again later, or sign in if you already have an account."
          : "We've sent several emails to that address already. Check your inbox and spam folder, then try again later.",
    };
  }

  const perHour = await rateLimitShared(`auth:${kind}:ih:${ip}`, limits.perIpHour.max, limits.perIpHour.windowSec);
  if (!perHour.allowed) {
    return { allowed: false, tripped: "ip-hour", error: "Too many attempts from this network. Try again in an hour." };
  }

  const perDay = await rateLimitShared(`auth:${kind}:id:${ip}`, limits.perIpDay.max, limits.perIpDay.windowSec);
  if (!perDay.allowed) {
    return {
      allowed: false,
      tripped: "ip-day",
      error: "Too many attempts from this network today. Try again tomorrow.",
      // Far past the daily cap is no longer a confused user — it's automation.
      shouldBan: perDay.count >= limits.banThresholdPerDay,
    };
  }

  return { allowed: true };
}

/** Exposed for tests and for documenting the effective limits. */
export function limitsFor(kind: AuthAttemptKind): KindLimits {
  return LIMITS[kind];
}
