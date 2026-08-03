import { NextResponse } from "next/server";
import { rateLimitShared } from "@/lib/apiRateLimit";
import { audit } from "@/lib/audit";
import { isIpBanned } from "@/lib/ipBan";
import { requireUser } from "@/lib/supabase/user";
import { requestIsVerifiedHuman } from "@/lib/turnstile";

/**
 * The single front door every public API route calls before doing real work.
 * It layers cheap, invisible bot/abuse defenses — no accounts, no user friction:
 *
 *   1. Cross-origin block  — reject browser POSTs whose Origin isn't this site
 *      (stops trivial cross-site scripts).
 *   2. Body-size cap       — reject oversized uploads before we read them.
 *   3. Per-IP rate limit   — a burst (per-minute) and a per-day cap, so one
 *      client (or bot) can't hammer the expensive AI endpoints.
 *   4. Global daily breaker— a hard ceiling on total AI requests/day across
 *      everyone, so even a distributed flood can't drain the free quota or run
 *      up the bill; real users see "at capacity" instead of errors.
 *
 * All counters live in Redis (durable, cross-instance) with an in-memory
 * fallback, so the guard is best-effort and never breaks the app itself.
 * NOTE: every new /api route must call guardApi — proxy.ts deliberately skips
 * /api, so there is no catch-all and an unguarded route is an open door.
 */

const DEFAULT_BODY_LIMIT = 256 * 1024; // 256 KB — plenty for JSON claims/prompts.

function numEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

const PER_IP_PER_MIN = numEnv(process.env.API_RATE_PER_MIN, 12);
const PER_IP_PER_DAY = numEnv(process.env.API_RATE_PER_DAY, 120);
const GLOBAL_DAILY = numEnv(process.env.API_GLOBAL_DAILY, 1500);

/** IP behind the request. Unlike lib/requestClient, this ignores the client-sent
 *  id header (a bot can forge it) — abuse keying must use the network IP. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim();
  if (ip) return ip;
  const real = req.headers.get("x-real-ip");
  return real?.trim() || "unknown";
}

/** True if the request is safe to treat as same-origin. Browsers attach Origin
 *  to same-origin POSTs; a mismatched Origin means a cross-site caller. A missing
 *  Origin (curl/native clients) isn't rejected here — the rate limit and BotID
 *  handle those — so we don't break legitimate non-browser use. */
export function sameOriginOk(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = req.headers.get("host");
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Returns true if Content-Length is present and exceeds `limitBytes`. */
export function bodyTooLarge(req: Request, limitBytes: number): boolean {
  const len = Number(req.headers.get("content-length"));
  return Number.isFinite(len) && len > limitBytes;
}

export interface GuardOptions {
  /** Bucket label for the rate-limit keys, e.g. "search". */
  name: string;
  /** Max request body in bytes (default 256 KB — raise for file uploads). */
  bodyLimitBytes?: number;
  /** Count this request toward the global daily AI ceiling (default true). */
  countGlobal?: boolean;
  /**
   * Require a valid "human" cookie (Turnstile gate). Default true. Set false on
   * the route that ISSUES the cookie (/api/verify-human). No-op when the gate is
   * off (no TURNSTILE_SECRET_KEY).
   */
  requireHuman?: boolean;
  /** Override the per-IP per-minute rate limit (default from API_RATE_PER_MIN).
   *  Raise it for frequent lightweight pings (e.g. presence heartbeats). */
  perMinute?: number;
  /** Override the per-IP per-DAY cap (default from API_RATE_PER_DAY). Must be
   *  raised for frequent heartbeats — a 15s presence ping is ~5,760/day, which
   *  would otherwise blow the default 120/day cap in half an hour and 429 the
   *  live count for the rest of the day. Not for AI tools (keep their daily cap). */
  perDay?: number;
  /**
   * Require a signed-in Supabase session (401 if none). Defense in depth on top
   * of the page proxy: the app's tools are only meant for logged-in users, so a
   * direct unauthenticated API call is rejected even if the proxy route-gate
   * were somehow bypassed. Default off.
   */
  requireAuth?: boolean;
}

function block(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

/**
 * Run the guard. Returns a NextResponse to send BACK (request blocked) or null
 * to proceed. Usage at the top of a route handler:
 *
 *   const blocked = await guardApi(req, { name: "search" });
 *   if (blocked) return blocked;
 */
export async function guardApi(req: Request, opts: GuardOptions): Promise<NextResponse | null> {
  if (!sameOriginOk(req)) {
    return block(403, "This request looks cross-site. Refresh the page and try again.");
  }

  // Ban list, checked before any real work. Cached in Redis so this costs ~0 on
  // the overwhelmingly common not-banned path, and fails OPEN if unreachable —
  // an unavailable ban list must not take the app down.
  const bannedIp = clientIp(req);
  if (await isIpBanned(bannedIp)) {
    void audit({ action: "ip.ban_blocked_request", ip: bannedIp, detail: { route: opts.name } });
    // Deliberately generic: telling an abuser exactly why they're blocked just
    // tells them what to change.
    return block(403, "This request was blocked. If you think that's a mistake, contact support.");
  }

  // Human gate (Turnstile). No-op when the gate is off; when on, a valid signed
  // cookie is required — bots can't get one, so they're blocked here cheaply.
  if (opts.requireHuman !== false && !requestIsVerifiedHuman(req)) {
    return block(
      403,
      "Please verify you're human — reload the page and complete the quick check, then try again.",
    );
  }

  // Session gate (defense in depth). Rejects unauthenticated calls to app-only
  // tools even if the page proxy were bypassed.
  if (opts.requireAuth) {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
  }

  if (bodyTooLarge(req, opts.bodyLimitBytes ?? DEFAULT_BODY_LIMIT)) {
    return block(413, "That upload is too large.");
  }

  const ip = bannedIp; // same value; resolved once above for the ban lookup.

  const perMin = await rateLimitShared(`m:${opts.name}:${ip}`, opts.perMinute ?? PER_IP_PER_MIN, 60);
  if (!perMin.allowed) {
    return block(429, "You're going a bit fast — wait a few seconds and try again.");
  }

  const perDay = await rateLimitShared(`d:${opts.name}:${ip}`, opts.perDay ?? PER_IP_PER_DAY, 86_400);
  if (!perDay.allowed) {
    return block(429, "You've hit today's usage limit for this tool. Try again tomorrow.");
  }

  if (opts.countGlobal !== false) {
    const global = await rateLimitShared("global:ai", GLOBAL_DAILY, 86_400);
    if (!global.allowed) {
      return block(503, "The Lab is at capacity right now. Please try again in a little while.");
    }
  }

  return null;
}
