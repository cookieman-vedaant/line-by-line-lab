import { getRedis } from "@/lib/redis";

/**
 * Live "who's online" presence. Each visitor sends a heartbeat every ~15s; we
 * record it with a timestamp and count everyone seen within the recent window.
 *
 * Backed by a Redis sorted set (durable + shared across serverless instances)
 * with an in-memory fallback (single instance) when Redis isn't configured.
 *
 * ADAPTABLE TO LOGIN: the presence is keyed by a caller-supplied `presenceKey`.
 * Today that's the anonymous per-browser id (from clientKeyFromRequest); when
 * accounts land, pass the user id instead — this file and the API/UI don't
 * change. Keying by id also dedupes multiple tabs of the same person to one.
 */

const KEY = "presence:online";
const WINDOW_MS = 40_000; // "online" = seen within the last 40s
const TTL_SECONDS = 120; // self-clean the key if all traffic stops

// Per-instance fallback (used only when Redis is absent).
const memory = new Map<string, number>();

/**
 * Pure: count members last seen within `windowMs` of `now`, pruning older ones
 * from `map` as a side effect. Unit-tested.
 */
export function countActive(map: Map<string, number>, now: number, windowMs: number): number {
  let count = 0;
  for (const [id, ts] of map) {
    if (now - ts <= windowMs) count += 1;
    else map.delete(id);
  }
  return count;
}

/**
 * Record a heartbeat for `presenceKey` and return the current online count.
 * Never throws — a Redis error falls back to the in-memory count.
 */
export async function heartbeat(presenceKey: string, now: number = Date.now()): Promise<number> {
  const redis = getRedis();
  if (!redis) {
    memory.set(presenceKey, now);
    return countActive(memory, now, WINDOW_MS);
  }
  try {
    await redis.zadd(KEY, { score: now, member: presenceKey });
    await redis.zremrangebyscore(KEY, 0, now - WINDOW_MS);
    await redis.expire(KEY, TTL_SECONDS);
    return await redis.zcard(KEY);
  } catch (err) {
    console.warn("presence heartbeat (redis) failed; in-memory fallback", String(err));
    memory.set(presenceKey, now);
    return countActive(memory, now, WINDOW_MS);
  }
}
