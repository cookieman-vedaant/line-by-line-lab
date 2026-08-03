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
/**
 * Hard ceiling on what may be written to Redis, in bytes of serialized JSON.
 *
 * WHY: Upstash bills by REQUEST and by BANDWIDTH, and a single full article can
 * serialize to 100-300 KB. Round-tripping payloads that size through a shared
 * cache burned through the free tier's limits far faster than the hit rate
 * justified — a big object is also the LEAST likely to be reused, because its
 * cache key is one specific URL or one specific pasted document.
 *
 * Oversized values still cache in L1 (in-process memory), which is free and
 * catches the common case of the same user repeating an action. They just never
 * hit the network. 64 KB comfortably fits search results, cut cards, and
 * re-highlight results — the values that genuinely benefit from being shared
 * across instances.
 */
const MAX_REDIS_BYTES = Number(process.env.CACHE_MAX_REDIS_BYTES) || 64 * 1024;

/** Serialized size without holding a second copy of the string around. */
function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY; // unserializable -> never send to Redis
  }
}

export function createSharedCache<V>(opts: {
  ttlMs: number;
  namespace: string;
  maxLocal?: number;
  /**
   * Set false for values that are large and rarely reused across users (e.g.
   * full article text). They stay in the in-process cache only, so they cost
   * nothing in Redis requests or bandwidth.
   */
  shareAcrossInstances?: boolean;
}) {
  const local = new TtlCache<V>(opts.ttlMs, opts.maxLocal ?? 50);
  const ttlSeconds = Math.max(1, Math.ceil(opts.ttlMs / 1000));
  const redisKey = (key: string) => `cache:${opts.namespace}:${key}`;
  const shared = opts.shareAcrossInstances !== false;

  return {
    async wrap(key: string, compute: () => Promise<V>): Promise<V> {
      const localHit = local.get(key);
      if (localHit !== undefined) return localHit;

      const redis = shared ? getRedis() : null;
      if (redis) {
        try {
          const hit = await redis.get<V>(redisKey(key));
          if (hit !== null && hit !== undefined) {
            local.set(key, hit);
            return hit;
          }
        } catch (err) {
          console.warn(`sharedCache[${opts.namespace}] get failed`, String(err));
        }
      }

      const value = await compute();
      local.set(key, value);

      if (redis) {
        const bytes = jsonBytes(value);
        if (bytes > MAX_REDIS_BYTES) {
          // Kept locally, never shipped. Logged so an unexpectedly huge payload
          // is visible rather than silently costing bandwidth forever.
          console.info(
            `sharedCache[${opts.namespace}] skipping Redis write: ${bytes} bytes > ${MAX_REDIS_BYTES} limit`,
          );
        } else {
          // Fire-and-forget: don't make the user wait on the cache write.
          void redis
            .set(redisKey(key), value, { ex: ttlSeconds })
            .catch((err) => console.warn(`sharedCache[${opts.namespace}] set failed`, String(err)));
        }
      }
      return value;
    },
  };
}
