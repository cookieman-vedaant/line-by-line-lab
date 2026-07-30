import { describe, expect, it } from "vitest";
import { createWebSearchLimiter } from "./rateLimit";

const T = (iso: string) => new Date(iso);

describe("createWebSearchLimiter", () => {
  it("allows up to the per-client daily limit, then blocks", () => {
    const limiter = createWebSearchLimiter({ dailyLimit: 3, monthlyLimit: 100 });
    const now = T("2026-07-30T10:00:00Z");
    expect(limiter.consume("a", now)).toBe(true);
    expect(limiter.consume("a", now)).toBe(true);
    expect(limiter.consume("a", now)).toBe(true);
    expect(limiter.consume("a", now)).toBe(false); // 4th same day → blocked
  });

  it("tracks clients independently", () => {
    const limiter = createWebSearchLimiter({ dailyLimit: 1, monthlyLimit: 100 });
    const now = T("2026-07-30T10:00:00Z");
    expect(limiter.consume("a", now)).toBe(true);
    expect(limiter.consume("a", now)).toBe(false);
    expect(limiter.consume("b", now)).toBe(true); // different client, own bucket
  });

  it("resets a client's daily count on a new UTC day", () => {
    const limiter = createWebSearchLimiter({ dailyLimit: 1, monthlyLimit: 100 });
    expect(limiter.consume("a", T("2026-07-30T23:59:00Z"))).toBe(true);
    expect(limiter.consume("a", T("2026-07-30T23:59:30Z"))).toBe(false);
    expect(limiter.consume("a", T("2026-07-31T00:01:00Z"))).toBe(true); // next day
  });

  it("enforces the global monthly cap across all clients", () => {
    const limiter = createWebSearchLimiter({ dailyLimit: 100, monthlyLimit: 2 });
    const now = T("2026-07-30T10:00:00Z");
    expect(limiter.consume("a", now)).toBe(true);
    expect(limiter.consume("b", now)).toBe(true);
    expect(limiter.consume("c", now)).toBe(false); // global budget exhausted
  });

  it("resets the global cap on a new month", () => {
    const limiter = createWebSearchLimiter({ dailyLimit: 100, monthlyLimit: 1 });
    expect(limiter.consume("a", T("2026-07-31T10:00:00Z"))).toBe(true);
    expect(limiter.consume("b", T("2026-07-31T10:00:00Z"))).toBe(false);
    expect(limiter.consume("b", T("2026-08-01T10:00:00Z"))).toBe(true); // new month
  });
});
