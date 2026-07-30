import { Redis } from "@upstash/redis";

/**
 * Shared serverless state via Upstash Redis (REST — safe on Vercel functions,
 * no connection pooling). This is the Tier-2 scaling substrate: a cross-instance
 * cache, a global Gemini rate throttle, and a durable web-search limiter.
 *
 * Fully OPTIONAL: with no Upstash env vars, getRedis() returns null and every
 * caller falls back to its in-memory behavior, so the app runs unchanged until
 * you connect Upstash (Vercel → Storage → Upstash Redis sets the vars for you).
 */

let cached: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  // Vercel's Upstash integration may expose either naming.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  cached = url && token ? new Redis({ url, token }) : null;
  if (!cached) {
    console.info("redis: not configured — using in-memory fallbacks (single-instance).");
  }
  return cached;
}

export function hasRedis(): boolean {
  return getRedis() !== null;
}
