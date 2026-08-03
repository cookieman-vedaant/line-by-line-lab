import { afterEach, describe, expect, it } from "vitest";
import { AI_TASKS, fallbackFor, modelFor } from "@/lib/models";

/**
 * The model registry decides what every AI call costs and how good it is, so the
 * invariants worth pinning are: tiers never regress, Pro is never weaker than
 * free, and the env overrides actually take effect (they're the lever for
 * retuning production without a deploy).
 */

const ENV_KEYS = [
  "GEMINI_MODEL_MARK",
  "GEMINI_MODEL_MARK_PRO",
  "GEMINI_MODEL_COACH",
  "GEMINI_MODEL_COACH_PRO",
  "GEMINI_THINKING_COACH",
  "GEMINI_THINKING_COACH_PRO",
];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("modelFor", () => {
  it("returns a model for every task on both tiers", () => {
    for (const task of AI_TASKS) {
      expect(modelFor(task, "free").model).toBeTruthy();
      expect(modelFor(task, "pro").model).toBeTruthy();
    }
  });

  it("defaults to the free tier when none is given", () => {
    expect(modelFor("coach")).toEqual(modelFor("coach", "free"));
  });

  it("keeps the quality-critical marker off the lite model on BOTH tiers", () => {
    // A lite marker highlights disconnected buzzwords instead of warrants —
    // the regression that made a per-task registry necessary in the first place.
    expect(modelFor("mark", "free").model).not.toContain("lite");
    expect(modelFor("mark", "pro").model).not.toContain("lite");
  });

  it("gives Pro a stronger coach than free, with thinking enabled", () => {
    const free = modelFor("coach", "free");
    const pro = modelFor("coach", "pro");
    expect(pro.model).not.toBe(free.model);
    // Thinking is the point: the Coach's output is prose, so there's no fragile
    // JSON to truncate, and reasoning is what the user is paying for.
    expect(pro.thinkingBudget).toBeGreaterThan(0);
    expect(free.thinkingBudget).toBe(0);
  });

  it("keeps thinking disabled for every JSON-producing task", () => {
    // A thinking model with a small output cap spends the budget reasoning and
    // truncates the JSON. Only `coach` returns free text.
    for (const task of AI_TASKS.filter((t) => t !== "coach")) {
      expect(modelFor(task, "free").thinkingBudget).toBe(0);
      expect(modelFor(task, "pro").thinkingBudget).toBe(0);
    }
  });

  it("lets a task-wide env var override the default", () => {
    process.env.GEMINI_MODEL_MARK = "test-model-x";
    expect(modelFor("mark", "free").model).toBe("test-model-x");
    expect(modelFor("mark", "pro").model).toBe("test-model-x");
  });

  it("prefers the tier-specific env var over the task-wide one", () => {
    process.env.GEMINI_MODEL_MARK = "task-wide";
    process.env.GEMINI_MODEL_MARK_PRO = "pro-only";
    expect(modelFor("mark", "free").model).toBe("task-wide");
    expect(modelFor("mark", "pro").model).toBe("pro-only");
  });

  it("allows the thinking budget to be tuned by env", () => {
    process.env.GEMINI_THINKING_COACH_PRO = "512";
    expect(modelFor("coach", "pro").thinkingBudget).toBe(512);
  });

  it("ignores a malformed thinking budget rather than crashing the call", () => {
    process.env.GEMINI_THINKING_COACH_PRO = "not-a-number";
    expect(modelFor("coach", "pro").thinkingBudget).toBeGreaterThan(0);
  });
});

describe("fallbackFor", () => {
  it("offers a cheaper fallback when the primary is a strong model", () => {
    expect(fallbackFor("mark", "pro")).toContain("lite");
  });

  it("returns null when the primary is already the fallback", () => {
    // Retrying lite with lite just burns another call for the same answer.
    expect(fallbackFor("expand", "free")).toBeNull();
  });
});
