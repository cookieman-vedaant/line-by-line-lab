import { describe, expect, it } from "vitest";
import { ModelUnavailableError, RateLimitedError, isDailyQuotaExhausted } from "@/lib/gemini";

/*
 * Telling "you're going too fast, wait 3 seconds" apart from "you've spent
 * today's allowance, come back tomorrow" is the whole fix. Both arrive as a 429
 * mentioning "quota", but only the first is worth retrying, and only the second
 * should park the model and fail over. Getting it wrong in the safe direction
 * (treating a daily cap as transient) is what burned ~10s of retries per call
 * and opened the circuit breaker on a healthy provider.
 *
 * The strings below are the REAL bodies this key returned, not invented ones.
 */

/** Verbatim from gemini-3.5-flash on the free tier, Aug 2026. */
const DAILY_429 = new Error(
  '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and ' +
    "billing details. For more information on this error, head to: " +
    "https://ai.google.dev/gemini-api/docs/rate-limits. \\n* Quota exceeded for metric: " +
    "generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: " +
    'gemini-3.5-flash\\nPlease retry in 24.962206319s.","status":"RESOURCE_EXHAUSTED",' +
    '"details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":' +
    '"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":' +
    '"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}',
);

const PER_MINUTE_429 = new Error(
  '{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).",' +
    '"status":"RESOURCE_EXHAUSTED","details":[{"@type":' +
    '"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":' +
    '"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}',
);

describe("isDailyQuotaExhausted", () => {
  it("recognises the real per-day exhaustion this key returns", () => {
    expect(isDailyQuotaExhausted(DAILY_429)).toBe(true);
  });

  /*
   * The per-day error advertises `retryDelay: 24.96s`, which is simply wrong —
   * the window is a day. Anything keying off that field would retry forever.
   */
  it("is not fooled by the misleading retry delay in the per-day body", () => {
    expect(DAILY_429.message).toContain("retry in 24.9");
    expect(isDailyQuotaExhausted(DAILY_429)).toBe(true);
  });

  it("leaves a per-MINUTE rate limit alone so it still gets retried", () => {
    expect(isDailyQuotaExhausted(PER_MINUTE_429)).toBe(false);
  });

  it("ignores non-quota failures", () => {
    expect(isDailyQuotaExhausted(new Error('{"error":{"code":503,"message":"overloaded"}}'))).toBe(
      false,
    );
    expect(isDailyQuotaExhausted(new Error('{"error":{"code":400,"message":"bad request"}}'))).toBe(
      false,
    );
    expect(isDailyQuotaExhausted("not an error")).toBe(false);
    expect(isDailyQuotaExhausted(undefined)).toBe(false);
  });
});

describe("ModelUnavailableError", () => {
  /*
   * Every existing graceful-degradation path — the marker's fallback, the
   * ranker's heuristic ordering, the re-highlighter — branches on
   * `instanceof RateLimitedError`. Inheriting keeps all of them working without
   * touching a line of their code.
   */
  it("is a RateLimitedError, so existing fallbacks still catch it", () => {
    const err = new ModelUnavailableError("gemini-3.5-flash");
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err).toBeInstanceOf(Error);
    expect(err.model).toBe("gemini-3.5-flash");
  });

  it("tells the user the truth about the window without leaking the model id", () => {
    const err = new ModelUnavailableError("gemini-3.5-flash");
    // "wait a few seconds" would be a lie for a daily cap.
    expect(err.message).not.toMatch(/few seconds/i);
    expect(err.message).toMatch(/today/i);
    expect(err.message).not.toContain("gemini");
  });
});
