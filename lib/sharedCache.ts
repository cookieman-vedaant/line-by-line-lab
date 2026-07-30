import { TtlCache } from "@/lib/cache";
import { getRedis } from "@/lib/redis";

/**
 * A two-tier cache: in-memory L1 (fast, per-instance) in front of Redis L2
 * (shared across ALL instances/users). The big scaling win — the same search or
 * cut anyone ran recently becomes a free hit for everyone, instead of every
 * instance paying full Gemini price on its own cold cache.
 *
 * Same `wrap(key, compute)` shape as TtlCache, so call sites don't change.
 * Redis is best-effort: any Redis error falls through to compute, never fails
 * the request. With no Redis configured it's just the in-memory cache.
 */
export function createSharedCache<V>(opts: {
  ttlMs: number;
  namespace: string;
  maxLocal?: number;
}) {
  const local = new TtlCache<V>(opts.ttlMs, opts.maxLocal ?? 50);
  const ttlSeconds = Math.max(1, Math.ceil(opts.ttlMs / 1000));
  const redisKey = (key: string) => `cache:${opts.namespace}:${key}`;

  return {
    async wrap(key: string, compute: () => Promise<V>): Promise<V> {
      const localHit = local.get(key);
      if (localHit !== undefined) return localHit;

      const redis = getRedis();
      if (redis) {
        try {
          const shared = await redis.get<V>(redisKey(key));
          if (shared !== null && shared !== undefined) {
            local.set(key, shared);
            return shared;
          }
        } catch (err) {
          console.warn(`sharedCache[${opts.namespace}] get failed`, String(err));
        }
      }

      const value = await compute();
      local.set(key, value);
      if (redis) {
        // Fire-and-forget: don't make the user wait on the cache write.
        void redis
          .set(redisKey(key), value, { ex: ttlSeconds })
          .catch((err) => console.warn(`sharedCache[${opts.namespace}] set failed`, String(err)));
      }
      return value;
    },
  };
}
