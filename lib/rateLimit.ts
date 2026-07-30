import { getRedis } from "@/lib/redis";

/**
 * Best-effort rate limiter that protects the free Tavily web-search budget.
 *
 * Two caps:
 *  - PER-CLIENT DAILY  — fair use, so one debater can't drain the month.
 *  - GLOBAL MONTHLY    — a hard backstop below the free-tier credit ceiling.
 *
 * When a cap is hit the caller skips the web tier and serves academic-only —
 * the app is never blocked, it just loses open-web breadth for that request.
 *
 * State is IN-MEMORY, so it resets on serverless cold starts and isn't shared
 * across instances — a SOFT guard that's sufficient at current scale. Phase 2
 * moves this onto Upstash Redis for a durable, cross-instance guarantee; keeping
 * it behind createWebSearchLimiter() makes that a one-file swap.
 */

const DEFAULT_DAILY_LIMIT = 5;
const DEFAULT_MONTHLY_LIMIT = 900; // Tavily free tier is 1,000 credits/month.

interface Counter {
  stamp: string;
  count: number;
}

export interface WebSearchLimiter {
  /** Consume one web-search unit for a client. false = over a cap → skip web. */
  consume(clientKey: string, now?: Date): boolean;
}

const dayStamp = (d: Date): string => d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
const monthStamp = (d: Date): string => d.toISOString().slice(0, 7); // YYYY-MM (UTC)

export function createWebSearchLimiter(opts?: {
  dailyLimit?: number;
  monthlyLimit?: number;
}): WebSearchLimiter {
  const dailyLimit = opts?.dailyLimit ?? DEFAULT_DAILY_LIMIT;
  const monthlyLimit = opts?.monthlyLimit ?? DEFAULT_MONTHLY_LIMIT;

  const perClient = new Map<string, Counter>();
  let global: Counter = { stamp: "", count: 0 };

  return {
    consume(clientKey: string, now: Date = new Date()): boolean {
      const today = dayStamp(now);
      const month = monthStamp(now);

      // Global monthly backstop.
      if (global.stamp !== month) global = { stamp: month, count: 0 };
      if (global.count >= monthlyLimit) return false;

      // Per-client daily bucket.
      const bucket = perClient.get(clientKey);
      if (!bucket || bucket.stamp !== today) {
        // New day for this client — reset it, and sweep other stale entries so
        // the map can't grow without bound.
        for (const [k, v] of perClient) {
          if (v.stamp !== today) perClient.delete(k);
        }
        perClient.set(clientKey, { stamp: today, count: 1 });
        global.count += 1;
        return true;
      }
      if (bucket.count >= dailyLimit) return false;
      bucket.count += 1;
      global.count += 1;
      return true;
    },
  };
}

/** Read a positive integer from an env var, else fall back. */
function numEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const DAILY_LIMIT = numEnv(process.env.WEB_SEARCH_DAILY_LIMIT, DEFAULT_DAILY_LIMIT);
const MONTHLY_LIMIT = numEnv(process.env.WEB_SEARCH_MONTHLY_LIMIT, DEFAULT_MONTHLY_LIMIT);

// App-wide IN-MEMORY singleton (per instance) — the fallback when Redis is off.
const limiter = createWebSearchLimiter({ dailyLimit: DAILY_LIMIT, monthlyLimit: MONTHLY_LIMIT });

/**
 * Consume one web-search unit for `clientKey`, IN-MEMORY (per instance). false =
 * over the client's daily cap or the global monthly cap → serve academic-only.
 * Prefer consumeWebSearchShared for the durable, cross-instance version.
 */
export function consumeWebSearch(clientKey: string): boolean {
  return limiter.consume(clientKey);
}

/**
 * Durable, CROSS-INSTANCE limiter backed by Redis. Same daily + monthly caps,
 * but the counters live in Redis so they survive cold starts and are shared
 * across serverless instances — a real budget guarantee, not a soft one. Falls
 * back to the in-memory limiter when Redis isn't configured or errors.
 */
export async function consumeWebSearchShared(
  clientKey: string,
  now: Date = new Date(),
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return consumeWebSearch(clientKey);

  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  const dailyKey = `web:daily:${day}:${clientKey}`;
  const monthlyKey = `web:monthly:${month}`;

  try {
    // Global monthly backstop first.
    const monthlyCount = await redis.incr(monthlyKey);
    if (monthlyCount === 1) await redis.expire(monthlyKey, 60 * 60 * 24 * 32);
    if (monthlyCount > MONTHLY_LIMIT) {
      await redis.decr(monthlyKey); // over budget — don't actually consume
      return false;
    }
    // Per-client daily cap.
    const dailyCount = await redis.incr(dailyKey);
    if (dailyCount === 1) await redis.expire(dailyKey, 60 * 60 * 26);
    if (dailyCount > DAILY_LIMIT) {
      await redis.decr(dailyKey);
      await redis.decr(monthlyKey); // roll back the monthly unit we reserved
      return false;
    }
    return true;
  } catch (err) {
    console.warn("web limiter (redis) failed; using in-memory fallback", String(err));
    return consumeWebSearch(clientKey);
  }
}
