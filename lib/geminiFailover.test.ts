import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The failover path, pinned without the network.
 *
 * It needs a mock rather than a live call because the condition it handles —
 * "this model has spent its 20-requests-per-day free allowance" — is only
 * reproducible for as long as the quota stays spent. It resets at midnight
 * Pacific, which is precisely when a live test would start passing for the wrong
 * reason. These tests hold regardless of the wall clock.
 */

const generateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

/** The shape the SDK throws on a spent daily allowance (abridged from the real body). */
const dailyQuotaError = () =>
  new Error(
    '{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED",' +
      '"details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}',
  );

const reply = (text: string) => ({ text, usageMetadata: {} });

const PRIMARY = "premium-model";
const FALLBACK = "cheap-model";

let generateJson: typeof import("@/lib/gemini").generateJson;
let ModelUnavailableError: typeof import("@/lib/gemini").ModelUnavailableError;
let getBreaker: typeof import("@/lib/circuitBreaker").getBreaker;
let resetModelAvailability: typeof import("@/lib/modelAvailability").resetModelAvailability;
let modelIsExhausted: typeof import("@/lib/modelAvailability").modelIsExhausted;

beforeEach(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  generateContent.mockReset();
  ({ generateJson, ModelUnavailableError } = await import("@/lib/gemini"));
  ({ getBreaker } = await import("@/lib/circuitBreaker"));
  ({ resetModelAvailability, modelIsExhausted } = await import("@/lib/modelAvailability"));
  resetModelAvailability();
});

afterEach(() => {
  resetModelAvailability();
});

/** Each test uses fresh model ids so it gets its own breaker (they're per-name). */
let seq = 0;
const uniq = (base: string) => `${base}-${++seq}`;

describe("generateJson model failover", () => {
  it("answers from the fallback when the preferred model is out of daily quota", async () => {
    const primary = uniq(PRIMARY);
    const fallback = uniq(FALLBACK);
    generateContent.mockImplementation(({ model }: { model: string }) => {
      if (model === primary) throw dailyQuotaError();
      return Promise.resolve(reply('{"marked":true}'));
    });

    const out = await generateJson({
      system: "s",
      prompt: "p",
      model: primary,
      fallbackModel: fallback,
      retries: 0,
    });

    expect(out).toEqual({ marked: true });
    expect(modelIsExhausted(primary)).toBe(true);
  });

  /*
   * The reason the registry exists. A cut fires eight marker sections through
   * Promise.all; before this, every one of them independently discovered the
   * premium model was dead on EVERY cut — and the failures opened a breaker that
   * took the healthy model down too.
   *
   * Note the honest bound. The first wave still costs one doomed call per
   * section, because all eight launch before any of them has failed; the
   * registry can only skip a model already KNOWN to be spent. What it removes is
   * the repeat: every cut after the first, for the rest of the probe window,
   * goes straight to the fallback. Coalescing that first wave would mean
   * serializing the hot path for every healthy call to save eight rejected
   * requests per ten minutes — the wrong trade.
   */
  it("stops calling a spent model once it is known to be spent", async () => {
    const primary = uniq(PRIMARY);
    const fallback = uniq(FALLBACK);
    generateContent.mockImplementation(({ model }: { model: string }) => {
      if (model === primary) throw dailyQuotaError();
      return Promise.resolve(reply('{"ok":true}'));
    });

    // One call discovers the model is spent.
    await generateJson({ system: "s", prompt: "p", model: primary, fallbackModel: fallback, retries: 0 });
    generateContent.mockClear();

    // The next cut's eight sections must not touch it at all.
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        generateJson({ system: "s", prompt: "p", model: primary, fallbackModel: fallback, retries: 0 }),
      ),
    );

    expect(results).toHaveLength(8);
    expect(results.every((r) => JSON.stringify(r) === '{"ok":true}')).toBe(true);

    const calls = generateContent.mock.calls.map((c) => (c[0] as { model: string }).model);
    expect(calls.filter((m) => m === primary)).toHaveLength(0);
    expect(calls.filter((m) => m === fallback)).toHaveLength(8);
  });

  /*
   * Running out of a daily allowance is a fact about the billing plan, not about
   * whether Gemini is reachable. Counting it would trip a breaker that no amount
   * of provider recovery could reset.
   */
  it("does not open the breaker for a quota exhaustion", async () => {
    const primary = uniq(PRIMARY);
    const fallback = uniq(FALLBACK);
    generateContent.mockImplementation(({ model }: { model: string }) => {
      if (model === primary) throw dailyQuotaError();
      return Promise.resolve(reply('{"ok":true}'));
    });

    for (let i = 0; i < 8; i++) {
      await generateJson({ system: "s", prompt: "p", model: primary, fallbackModel: fallback, retries: 0 });
    }

    expect(getBreaker(`gemini:${primary}`).state()).toBe("closed");
    expect(getBreaker(`gemini:${fallback}`).state()).toBe("closed");
  });

  it("keeps a spent model from touching an unrelated healthy model", async () => {
    const primary = uniq(PRIMARY);
    const other = uniq("healthy");
    generateContent.mockImplementation(({ model }: { model: string }) => {
      if (model === primary) throw dailyQuotaError();
      return Promise.resolve(reply('{"ok":true}'));
    });

    // Spend the premium model with no fallback configured.
    await expect(
      generateJson({ system: "s", prompt: "p", model: primary, retries: 0 }),
    ).rejects.toBeInstanceOf(ModelUnavailableError);

    // The healthy model is entirely unaffected — the old shared breaker is gone.
    await expect(
      generateJson({ system: "s", prompt: "p", model: other, retries: 0 }),
    ).resolves.toEqual({ ok: true });
  });

  it("returns to the preferred model once it answers again (billing enabled)", async () => {
    process.env.GEMINI_MODEL_PROBE_MINUTES = "0.0001"; // ~6ms, so the probe is due
    const primary = uniq(PRIMARY);
    const fallback = uniq(FALLBACK);
    let capped = true;
    generateContent.mockImplementation(({ model }: { model: string }) => {
      if (model === primary && capped) throw dailyQuotaError();
      return Promise.resolve(reply(model === primary ? '{"from":"premium"}' : '{"from":"cheap"}'));
    });

    await expect(
      generateJson({ system: "s", prompt: "p", model: primary, fallbackModel: fallback, retries: 0 }),
    ).resolves.toEqual({ from: "cheap" });

    capped = false; // the cap is lifted — nothing is redeployed or reconfigured
    await new Promise((r) => setTimeout(r, 20));

    await expect(
      generateJson({ system: "s", prompt: "p", model: primary, fallbackModel: fallback, retries: 0 }),
    ).resolves.toEqual({ from: "premium" });
    expect(modelIsExhausted(primary)).toBe(false);
    delete process.env.GEMINI_MODEL_PROBE_MINUTES;
  });

  /*
   * Regression: a live cut died exactly this way. The marker passes `retries: 0`
   * so a doomed premium call fails fast — but that setting was carried into the
   * fallback too, so when eight sections all landed on the cheap model at once
   * and one met a per-minute 429, the card failed instead of waiting 3 seconds.
   * The fallback is the last resort and must get the normal retry ladder.
   */
  it("retries on the fallback even when the caller asked to fail fast", async () => {
    const primary = uniq(PRIMARY);
    const fallback = uniq(FALLBACK);
    let fallbackCalls = 0;
    generateContent.mockImplementation(({ model }: { model: string }) => {
      if (model === primary) throw dailyQuotaError();
      fallbackCalls++;
      // A transient per-minute limit on the first fallback attempt only.
      if (fallbackCalls === 1) {
        throw new Error('{"error":{"code":429,"message":"Resource has been exhausted"}}');
      }
      return Promise.resolve(reply('{"ok":true}'));
    });

    vi.useFakeTimers();
    try {
      const pending = generateJson({
        system: "s",
        prompt: "p",
        model: primary,
        fallbackModel: fallback,
        retries: 0,
      });
      await vi.advanceTimersByTimeAsync(5_000); // clear the backoff
      await expect(pending).resolves.toEqual({ ok: true });
      expect(fallbackCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes a non-quota failure through instead of silently failing over", async () => {
    const primary = uniq(PRIMARY);
    const fallback = uniq(FALLBACK);
    generateContent.mockImplementation(({ model }: { model: string }) => {
      if (model === primary) throw new Error('{"error":{"code":400,"message":"invalid argument"}}');
      return Promise.resolve(reply('{"ok":true}'));
    });

    // A 400 is OUR bug. Quietly answering from another model would hide it.
    await expect(
      generateJson({ system: "s", prompt: "p", model: primary, fallbackModel: fallback, retries: 0 }),
    ).rejects.toThrow(/invalid argument/);
    expect(generateContent.mock.calls.filter((c) => (c[0] as { model: string }).model === fallback)).toHaveLength(0);
  });
});
