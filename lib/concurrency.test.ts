import { describe, expect, it } from "vitest";
import { createLimiter, mapWithConcurrency } from "./concurrency";

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe("createLimiter", () => {
  it("never runs more than `max` tasks at once", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    };
    await Promise.all(Array.from({ length: 7 }, () => run(task)));
    expect(peak).toBe(2);
  });

  it("never lets a newcomer slip in while a freed slot passes to a waiter", async () => {
    const run = createLimiter(1);
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    };
    const first = run(task);
    const waiter = run(task);
    // Arrives in the same tick the first task finishes — the old gap.
    const newcomer = first.then(() => run(task));
    await Promise.all([first, waiter, newcomer]);
    expect(peak).toBe(1);
  });

  it("frees the slot when a task throws", async () => {
    const run = createLimiter(1);
    await expect(run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(run(async () => "next")).resolves.toBe("next");
  });
});

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of finish order", async () => {
    const out = await mapWithConcurrency([30, 5, 15], 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2]);
  });
});
