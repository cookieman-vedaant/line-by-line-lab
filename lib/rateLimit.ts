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

// App-wide singleton. Limits are env-tunable without a code change.
const limiter = createWebSearchLimiter({
  dailyLimit: numEnv(process.env.WEB_SEARCH_DAILY_LIMIT, DEFAULT_DAILY_LIMIT),
  monthlyLimit: numEnv(process.env.WEB_SEARCH_MONTHLY_LIMIT, DEFAULT_MONTHLY_LIMIT),
});

/**
 * Consume one web-search unit for `clientKey`. Returns false when the client's
 * daily cap or the global monthly cap is reached — the caller then serves
 * academic-only results instead of hitting the paid-quota web search.
 */
export function consumeWebSearch(clientKey: string): boolean {
  return limiter.consume(clientKey);
}
