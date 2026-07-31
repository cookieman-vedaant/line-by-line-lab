import { describe, expect, it } from "vitest";
import { countActive } from "@/lib/presence";

describe("countActive", () => {
  it("counts members seen within the window", () => {
    const now = 1_000_000;
    const map = new Map([
      ["a", now - 1000],
      ["b", now - 39_000],
    ]);
    expect(countActive(map, now, 40_000)).toBe(2);
  });

  it("prunes and excludes members older than the window", () => {
    const now = 1_000_000;
    const map = new Map([
      ["fresh", now - 5_000],
      ["stale", now - 60_000],
    ]);
    expect(countActive(map, now, 40_000)).toBe(1);
    expect(map.has("stale")).toBe(false); // pruned as a side effect
    expect(map.has("fresh")).toBe(true);
  });

  it("is 0 for an empty set", () => {
    expect(countActive(new Map(), 1_000_000, 40_000)).toBe(0);
  });
});
