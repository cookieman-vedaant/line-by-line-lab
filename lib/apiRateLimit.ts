import { getRedis } from "@/lib/redis";

/**
 * General fixed-window rate limiting for the public API routes — the core bot
 * defense. Each caller picks a key (e.g. "m:search:<ip>") plus a limit and a
 * window; we count hits per window and report whether the caller is still under
 * the limit.
 *
 * Two backends, same shape:
 *  - IN-MEMORY (createFixedWindowLimiter) — per instance, resets on cold start.
 *    Fully deterministic (inject `now`) so it's unit-testable.
 *  - REDIS (rateLimitShared) — durable + cross-instance via Upstash, the real
 *    guarantee. Falls back to the in-memory limiter when Redis isn't configured
 *    or errors, so the app never breaks because the limiter is unavailable.
 *
 * Mirrors the design of lib/rateLimit.ts (the Tavily budget limiter); this one
 * caps request RATE per client rather than a monthly credit budget.
 */

export interface RateResult {
  allowed: boolean;
  count: number;
}

export interface FixedWindowLimiter {
  /** Record one hit for `key`; allowed = still within `limit` this window. */
  hit(key: string, limit: number, windowMs: number, now?: number): RateResult;
}

export function createFixedWindowLimiter(): FixedWindowLimiter {
  // key -> { windowEnd (absolute ms), count }. windowEnd lets us sweep stale
  // entries without knowing each key's window size.
  const counters = new Map<string, { windowEnd: number; count: number }>();
  let lastSweep = 0;

  return {
    hit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateResult {
      // Periodically drop expired windows so the map can't grow without bound.
      if (now - lastSweep > 60_000) {
        for (const [k, v] of counters) if (v.windowEnd <= now) counters.delete(k);
        lastSweep = now;
      }

      const cur = counters.get(key);
      if (!cur || cur.windowEnd <= now) {
        const windowEnd = (Math.floor(now / windowMs) + 1) * windowMs;
        counters.set(key, { windowEnd, count: 1 });
        return { allowed: 1 <= limit, count: 1 };
      }
      cur.count += 1;
      return { allowed: cur.count <= limit, count: cur.count };
    },
  };
}

// App-wide in-memory singleton — the fallback when Redis is off.
const memLimiter = createFixedWindowLimiter();

/**
 * Durable, cross-instance fixed-window limit backed by Redis. `windowSec` is the
 * window length in seconds; the counter key is bucketed by window so it self-
 * expires. Falls back to the in-memory limiter when Redis is absent or errors.
 */
export async function rateLimitShared(
  key: string,
  limit: number,
  windowSec: number,
  now: number = Date.now(),
): Promise<RateResult> {
  const redis = getRedis();
  if (!redis) return memLimiter.hit(key, limit, windowSec * 1000, now);

  const windowId = Math.floor(now / 1000 / windowSec);
  const redisKey = `rl:${key}:${windowId}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSec + 2);
    return { allowed: count <= limit, count };
  } catch (err) {
    console.warn("rateLimitShared: redis failed, in-memory fallback", String(err));
    return memLimiter.hit(key, limit, windowSec * 1000, now);
  }
}
