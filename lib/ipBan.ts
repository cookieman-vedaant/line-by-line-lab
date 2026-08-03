import "server-only";
import { getRedis } from "@/lib/redis";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * IP ban list — the backstop behind the rate limiter.
 *
 * Rate limits slow an abuser down; a ban stops them. The motivating case is one
 * person creating throwaway accounts in bulk to farm free AI calls: each
 * individual signup looks legitimate, so only the pattern across accounts gives
 * them away.
 *
 * Storage is two-layer, and the split is deliberate:
 *  - POSTGRES (`ip_bans`) is the source of truth — durable, inspectable in the
 *    dashboard, survives a Redis flush.
 *  - REDIS is a short-TTL cache in front of it, because this is checked on EVERY
 *    guarded request and a database round trip per request would be a real
 *    latency tax. Negative results are cached too (that's the common case).
 *
 * Fails OPEN: if both stores are unreachable, requests are allowed. A ban list
 * that can't be read must not take the whole app offline — rate limiting and
 * Turnstile are still standing behind it.
 */

const CACHE_TTL_SEC = 300; // 5 min — a new ban takes at most this long to bite.
const NEGATIVE = "0";
const POSITIVE = "1";

function cacheKey(ip: string): string {
  return `ipban:${ip}`;
}

/**
 * In-memory L1 cache, used when Redis isn't configured. Without it, EVERY
 * guarded request pays a PostgREST round trip just to learn the caller isn't
 * banned — measured at one wasted lookup per request in local testing. The ban
 * check sits in front of every API route, so that cost lands on the hot path of
 * the whole app.
 */
const memCache = new Map<string, { banned: boolean; expires: number }>();

function memGet(ip: string): boolean | undefined {
  const hit = memCache.get(ip);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    memCache.delete(ip);
    return undefined;
  }
  return hit.banned;
}

function memSet(ip: string, banned: boolean): void {
  // Bound the map so a flood of distinct IPs can't grow it without limit.
  if (memCache.size > 5000) memCache.clear();
  memCache.set(ip, { banned, expires: Date.now() + CACHE_TTL_SEC * 1000 });
}

/**
 * Latch for "the ip_bans table doesn't exist here".
 *
 * The migrations are applied by a human, so there is a real window (and whole
 * environments — a fresh clone, a preview branch) where this table is absent.
 * Retrying a lookup that cannot succeed, on every request forever, is pure
 * latency. Detect it once, log once, then skip the lookup entirely.
 *
 * Deliberately NOT reset at runtime: a process restart re-checks, which is the
 * right granularity, since applying a migration doesn't need to take effect
 * mid-process on a serverless instance that will be recycled shortly anyway.
 */
let tableMissing = false;

/** PostgREST's code for "relation not in the schema cache". */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "PGRST205" || /Could not find the table/i.test(err.message ?? "");
}

/** Normalize so "1.2.3.4 " and "1.2.3.4" can't be treated as different clients. */
export function normalizeIp(ip: string): string {
  return ip.trim().toLowerCase();
}

/**
 * True if this IP is currently banned. Checks the Redis cache first, then
 * Postgres. Expired bans (expires_at in the past) do NOT count as banned.
 */
export async function isIpBanned(rawIp: string): Promise<boolean> {
  const ip = normalizeIp(rawIp);
  if (!ip || ip === "unknown") return false;
  // The table isn't deployed in this environment — nothing to look up.
  if (tableMissing) return false;

  // L1: in-process. Cheapest, and the only cache when Redis isn't configured.
  const local = memGet(ip);
  if (local !== undefined) return local;

  // L2: Redis, shared across instances so a ban propagates fleet-wide.
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<string>(cacheKey(ip));
      if (cached === POSITIVE) {
        memSet(ip, true);
        return true;
      }
      if (cached === NEGATIVE) {
        memSet(ip, false);
        return false;
      }
    } catch (err) {
      console.warn("ipBan: redis read failed", String(err));
    }
  }

  let banned = false;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("ip_bans")
      .select("ip,expires_at")
      .eq("ip", ip)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) {
        // Latch OFF permanently for this process. Logged once, not once per
        // request — an un-migrated environment shouldn't spam the logs or pay
        // a network round trip on every single request.
        tableMissing = true;
        console.warn(
          "ipBan: ip_bans table not found — IP ban checks disabled for this process. " +
            "Apply supabase/migrations to enable them.",
        );
        return false;
      }
      console.warn("ipBan: lookup failed", error.message);
      return false; // fail open
    }
    if (data) {
      const expires = (data as { expires_at: string | null }).expires_at;
      banned = expires === null || new Date(expires).getTime() > Date.now();
    }
  } catch (err) {
    console.warn("ipBan: unavailable, failing open", String(err));
    return false;
  }

  memSet(ip, banned);
  if (redis) {
    try {
      await redis.set(cacheKey(ip), banned ? POSITIVE : NEGATIVE, { ex: CACHE_TTL_SEC });
    } catch {
      // Cache write is an optimization; a miss just means another DB read.
    }
  }
  return banned;
}

export interface BanOptions {
  reason?: string;
  /** Minutes until the ban lifts. Omit for a permanent ban. */
  durationMinutes?: number;
}

/**
 * Ban an IP. Prefer a DURATION over a permanent ban for anything automated: a
 * school or library NAT puts an entire building behind one address, so a
 * permanent auto-ban can lock out a whole team over one bad actor. Reserve
 * permanent bans for decisions a human made.
 */
export async function banIp(rawIp: string, opts: BanOptions = {}): Promise<boolean> {
  const ip = normalizeIp(rawIp);
  if (!ip || ip === "unknown") return false;

  const expiresAt = opts.durationMinutes
    ? new Date(Date.now() + opts.durationMinutes * 60_000).toISOString()
    : null;

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("ip_bans")
      .upsert({ ip, reason: opts.reason ?? null, expires_at: expiresAt }, { onConflict: "ip" });
    if (error) {
      console.warn("ipBan: ban write failed", error.message);
      return false;
    }
  } catch (err) {
    console.warn("ipBan: ban unavailable", String(err));
    return false;
  }

  // Invalidate BOTH caches, or the instance that just issued the ban would keep
  // serving its own stale "not banned" answer until the TTL expired.
  memSet(ip, true);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(cacheKey(ip), POSITIVE, { ex: CACHE_TTL_SEC });
    } catch {
      // Non-fatal: the Postgres row is authoritative.
    }
  }
  return true;
}

/** Lift a ban (used to undo a false positive). */
export async function unbanIp(rawIp: string): Promise<boolean> {
  const ip = normalizeIp(rawIp);
  if (!ip) return false;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("ip_bans").delete().eq("ip", ip);
    if (error) {
      console.warn("ipBan: unban failed", error.message);
      return false;
    }
  } catch (err) {
    console.warn("ipBan: unban unavailable", String(err));
    return false;
  }
  memSet(ip, false);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(cacheKey(ip), NEGATIVE, { ex: CACHE_TTL_SEC });
    } catch {
      // Non-fatal.
    }
  }
  return true;
}
