import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimModelAttempt,
  markModelAvailable,
  markModelExhausted,
  modelIsExhausted,
  resetModelAvailability,
} from "@/lib/modelAvailability";

/*
 * The registry exists because of a real outage shape: gemini-3.5-flash is capped
 * at 20 requests/DAY on the free tier, one card cut fires eight marker calls at
 * it concurrently, and the resulting failures opened a shared circuit breaker
 * that took the healthy models down too. These tests pin the two properties that
 * prevent a repeat — skip a model that's out of quota, and let exactly one
 * caller re-probe it.
 */

const MODEL = "gemini-3.5-flash";
const PROBE_MS = 10 * 60_000; // the default 10-minute window

beforeEach(() => {
  resetModelAvailability();
  delete process.env.GEMINI_MODEL_PROBE_MINUTES;
});
afterEach(() => {
  resetModelAvailability();
  delete process.env.GEMINI_MODEL_PROBE_MINUTES;
});

describe("claimModelAttempt", () => {
  it("allows a model nobody has reported a problem with", () => {
    expect(claimModelAttempt(MODEL, 0)).toBe(true);
    expect(modelIsExhausted(MODEL, 0)).toBe(false);
  });

  it("skips an exhausted model for the whole probe window", () => {
    markModelExhausted(MODEL, 0);
    expect(claimModelAttempt(MODEL, 0)).toBe(false);
    expect(claimModelAttempt(MODEL, PROBE_MS - 1)).toBe(false);
    expect(modelIsExhausted(MODEL, PROBE_MS - 1)).toBe(true);
  });

  /*
   * THE point of the module. A cut fans eight marker calls out through
   * Promise.all, so all eight ask at the same instant. Before this, all eight
   * called a model already known to be dead — eight pointless round trips and
   * enough breaker failures to take the whole AI layer offline.
   */
  it("hands the probe to exactly ONE of eight concurrent callers", () => {
    markModelExhausted(MODEL, 0);
    const allowed = Array.from({ length: 8 }, () => claimModelAttempt(MODEL, PROBE_MS));
    expect(allowed.filter(Boolean)).toHaveLength(1);
  });

  it("re-arms the full window when the probe also fails", () => {
    markModelExhausted(MODEL, 0);
    expect(claimModelAttempt(MODEL, PROBE_MS)).toBe(true); // the probe
    markModelExhausted(MODEL, PROBE_MS); // ...which failed again
    expect(claimModelAttempt(MODEL, PROBE_MS + 1)).toBe(false);
    expect(claimModelAttempt(MODEL, PROBE_MS * 2)).toBe(true);
  });

  /*
   * The reason the window is a re-probe rather than a wait until midnight:
   * enabling billing lifts the cap immediately, and the next probe succeeding is
   * what returns the app to the premium model with no redeploy.
   */
  it("restores the model as soon as one call succeeds", () => {
    markModelExhausted(MODEL, 0);
    expect(claimModelAttempt(MODEL, 0)).toBe(false);
    markModelAvailable(MODEL);
    expect(claimModelAttempt(MODEL, 0)).toBe(true);
    expect(modelIsExhausted(MODEL, 0)).toBe(false);
  });

  it("never lets a hung probe latch the model out forever", () => {
    markModelExhausted(MODEL, 0);
    expect(claimModelAttempt(MODEL, PROBE_MS)).toBe(true); // probe starts...
    expect(claimModelAttempt(MODEL, PROBE_MS + 1_000)).toBe(false); // ...still running
    // A probe that never settled must not park the model permanently.
    expect(claimModelAttempt(MODEL, PROBE_MS + 61_000)).toBe(true);
  });

  it("tracks models independently — one being dead says nothing about another", () => {
    markModelExhausted(MODEL, 0);
    expect(claimModelAttempt(MODEL, 0)).toBe(false);
    expect(claimModelAttempt("gemini-3.1-flash-lite", 0)).toBe(true);
  });

  it("honours GEMINI_MODEL_PROBE_MINUTES", () => {
    process.env.GEMINI_MODEL_PROBE_MINUTES = "1";
    markModelExhausted(MODEL, 0);
    expect(claimModelAttempt(MODEL, 59_000)).toBe(false);
    expect(claimModelAttempt(MODEL, 60_000)).toBe(true);
  });

  it("falls back to the default window on a nonsense override", () => {
    process.env.GEMINI_MODEL_PROBE_MINUTES = "not-a-number";
    markModelExhausted(MODEL, 0);
    expect(claimModelAttempt(MODEL, PROBE_MS - 1)).toBe(false);
    expect(claimModelAttempt(MODEL, PROBE_MS)).toBe(true);
  });
});
