import { describe, expect, it } from "vitest";
import { createSharedCache } from "@/lib/sharedCache";

/** A fresh namespace per test so nothing collides with a real Redis, if present. */
function uniqueNs(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("createSharedCache shouldCache", () => {
  it("memoizes by default — the same key computes once", async () => {
    const cache = createSharedCache<number>({ ttlMs: 60_000, namespace: uniqueNs() });
    let calls = 0;
    const compute = async () => {
      calls++;
      return 42;
    };
    expect(await cache.wrap("k", compute)).toBe(42);
    expect(await cache.wrap("k", compute)).toBe(42);
    expect(calls).toBe(1);
  });

  it("never caches when shouldCache returns false — recomputes every call", async () => {
    const cache = createSharedCache<number>({ ttlMs: 60_000, namespace: uniqueNs() });
    let calls = 0;
    const compute = async () => {
      calls++;
      return calls;
    };
    const never = () => false;
    expect(await cache.wrap("k", compute, never)).toBe(1);
    expect(await cache.wrap("k", compute, never)).toBe(2);
    expect(calls).toBe(2);
  });

  it("caches results that pass the predicate but not those that fail it", async () => {
    // Mirrors wiki search: cache a non-empty result, never an empty one (the
    // index is still filling, so 'no matches' is only true for this instant).
    const cache = createSharedCache<{ items: number[] }>({ ttlMs: 60_000, namespace: uniqueNs() });
    const keepNonEmpty = (v: { items: number[] }) => v.items.length > 0;

    let emptyCalls = 0;
    const emptyCompute = async () => {
      emptyCalls++;
      return { items: [] as number[] };
    };
    await cache.wrap("q", emptyCompute, keepNonEmpty);
    await cache.wrap("q", emptyCompute, keepNonEmpty);
    expect(emptyCalls).toBe(2); // empty result was never cached

    let fullCalls = 0;
    const fullCompute = async () => {
      fullCalls++;
      return { items: [1] };
    };
    await cache.wrap("q2", fullCompute, keepNonEmpty);
    await cache.wrap("q2", fullCompute, keepNonEmpty);
    expect(fullCalls).toBe(1); // non-empty result was cached after the first call
  });
});
