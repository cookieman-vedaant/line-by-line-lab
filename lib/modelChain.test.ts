import { ThinkingLevel } from "@google/genai";
import { afterEach, describe, expect, it } from "vitest";
import { modelChain, thinkingConfigFor } from "@/lib/models";

/*
 * Measured 2026-09-25 on this key: gemini-3.1-flash-lite answered 503 "high
 * demand" on 2 of 6 calls and once took 72s; gemini-3.5-flash 503'd on 4 of 6.
 * gemini-3.6-flash and gemini-3.5-flash-lite answered every call in ~1s. A call
 * that can only fall back from one overloaded model to the other is how the
 * finder ended up "ranked by keyword match" and cards were marked by the
 * weakest model.
 */
describe("modelChain", () => {
  afterEach(() => {
    delete process.env.GEMINI_FAILOVER_FROM_STRONG;
    delete process.env.GEMINI_FAILOVER_FROM_LITE;
  });

  it("keeps a strong task on strong models first, then the better lite model", () => {
    expect(modelChain("gemini-3.5-flash")).toEqual([
      "gemini-3.5-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
    ]);
  });

  it("keeps a lite task on lite models first, then the cheaper strong model", () => {
    expect(modelChain("gemini-3.1-flash-lite")).toEqual([
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
    ]);
  });

  it("starts from whichever model the task asked for", () => {
    expect(modelChain("gemini-3.6-flash")[0]).toBe("gemini-3.6-flash");
    expect(new Set(modelChain("gemini-3.6-flash")).size).toBe(4);
  });

  it("leaves a model it hasn't verified alone, apart from the caller's own fallback", () => {
    expect(modelChain("some-override-model")).toEqual(["some-override-model"]);
    expect(modelChain("some-override-model", "gemini-3.1-flash-lite")).toEqual([
      "some-override-model",
      "gemini-3.1-flash-lite",
    ]);
  });

  it("keeps the caller's fallback when the chain doesn't already hold it", () => {
    expect(modelChain("gemini-3.5-flash", "custom-fallback").at(-1)).toBe("custom-fallback");
    expect(modelChain("gemini-3.5-flash", "gemini-3.1-flash-lite")).toHaveLength(4);
  });

  it("can be retuned from the environment without a deploy", () => {
    process.env.GEMINI_FAILOVER_FROM_LITE = "gemini-3.1-flash-lite, gemini-3.6-flash";
    expect(modelChain("gemini-3.1-flash-lite")).toEqual(["gemini-3.1-flash-lite", "gemini-3.6-flash"]);
  });
});

describe("thinkingConfigFor", () => {
  it("disables thinking with a budget on the models that take one", () => {
    expect(thinkingConfigFor("gemini-3.1-flash-lite", 0)).toEqual({ thinkingBudget: 0 });
    expect(thinkingConfigFor("gemini-3.6-flash", 2048)).toEqual({ thinkingBudget: 2048 });
  });

  it("uses a thinking LEVEL on gemini-3.5-flash-lite, which 400s on thinkingBudget", () => {
    expect(thinkingConfigFor("gemini-3.5-flash-lite", 0)).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
    expect(thinkingConfigFor("gemini-3.5-flash-lite", 2048)).toEqual({ thinkingLevel: ThinkingLevel.LOW });
  });
});
