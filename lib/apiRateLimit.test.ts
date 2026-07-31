import { describe, expect, it } from "vitest";
import { createFixedWindowLimiter } from "@/lib/apiRateLimit";

describe("createFixedWindowLimiter", () => {
  it("allows up to the limit then blocks within a window", () => {
    const lim = createFixedWindowLimiter();
    const t = 1_000_000;
    expect(lim.hit("ip:1", 3, 60_000, t).allowed).toBe(true); // 1
    expect(lim.hit("ip:1", 3, 60_000, t + 1).allowed).toBe(true); // 2
    expect(lim.hit("ip:1", 3, 60_000, t + 2).allowed).toBe(true); // 3
    const fourth = lim.hit("ip:1", 3, 60_000, t + 3);
    expect(fourth.allowed).toBe(false); // 4 — over
    expect(fourth.count).toBe(4);
  });

  it("resets once the window elapses", () => {
    const lim = createFixedWindowLimiter();
    // Anchor to a window boundary so t and t+window land in different windows.
    const t = 60_000 * 5;
    lim.hit("ip:2", 1, 60_000, t);
    expect(lim.hit("ip:2", 1, 60_000, t + 10).allowed).toBe(false); // same window, over
    const next = lim.hit("ip:2", 1, 60_000, t + 60_000); // next window
    expect(next.allowed).toBe(true);
    expect(next.count).toBe(1);
  });

  it("tracks keys independently", () => {
    const lim = createFixedWindowLimiter();
    const t = 2_000_000;
    lim.hit("ip:a", 1, 60_000, t);
    expect(lim.hit("ip:a", 1, 60_000, t + 1).allowed).toBe(false);
    expect(lim.hit("ip:b", 1, 60_000, t + 1).allowed).toBe(true); // different key unaffected
  });

  it("a limit of 0 blocks the very first hit", () => {
    const lim = createFixedWindowLimiter();
    expect(lim.hit("ip:z", 0, 60_000, 5_000_000).allowed).toBe(false);
  });
});
