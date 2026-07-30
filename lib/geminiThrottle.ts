import { getRedis } from "@/lib/redis";

/**
 * Best-effort GLOBAL rate smoothing for the shared free Gemini key, across all
 * serverless instances. A fixed per-minute counter in Redis; when the minute is
 * over budget, a call waits a jittered beat to spread the load instead of piling
 * onto the key (which would 429 everyone). This is smoothing, NOT a hard gate —
 * it never rejects a call; the real 429 + retry/backoff is the final backstop.
 *
 * No Redis configured → no-op (the in-process concurrency gate still applies).
 */

const RPM_LIMIT = (() => {
  const n = Number(process.env.GEMINI_RPM_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 55; // under the free RPM
})();

export async function throttleGemini(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const minute = Math.floor(Date.now() / 60000);
    const bucket = `gemini:rpm:${minute}`;
    const count = await redis.incr(bucket);
    if (count === 1) await redis.expire(bucket, 120);
    if (count > RPM_LIMIT) {
      // Over the per-minute budget — spread this call out rather than hammer the
      // shared key. A short jittered wait smooths the burst.
      await new Promise((resolve) => setTimeout(resolve, 1000 + Math.floor(Math.random() * 2000)));
    }
  } catch (err) {
    console.warn("geminiThrottle failed (proceeding without it)", String(err));
  }
}
