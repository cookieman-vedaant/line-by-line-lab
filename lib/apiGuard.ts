import { NextResponse } from "next/server";
import { rateLimitShared } from "@/lib/apiRateLimit";

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
 * NOTE: every new /api route must call guardApi — there is no middleware
 * catch-all, so an unguarded route is an open door.
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

  if (bodyTooLarge(req, opts.bodyLimitBytes ?? DEFAULT_BODY_LIMIT)) {
    return block(413, "That upload is too large.");
  }

  const ip = clientIp(req);

  const perMin = await rateLimitShared(`m:${opts.name}:${ip}`, PER_IP_PER_MIN, 60);
  if (!perMin.allowed) {
    return block(429, "You're going a bit fast — wait a few seconds and try again.");
  }

  const perDay = await rateLimitShared(`d:${opts.name}:${ip}`, PER_IP_PER_DAY, 86_400);
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
