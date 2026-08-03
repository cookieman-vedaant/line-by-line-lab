import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These limits are what stand between one person and an unlimited supply of
 * throwaway accounts, so the properties worth locking down are: the counters are
 * keyed per-email AND per-IP independently, raw addresses never reach the
 * counter store, and the auto-ban only fires far past the ordinary cap.
 *
 * `rateLimitShared` is mocked so the tests exercise the DECISION logic without a
 * Redis dependency or real clock.
 */

const hits = vi.hoisted(() => new Map<string, number>());

vi.mock("@/lib/apiRateLimit", () => ({
  rateLimitShared: vi.fn(async (key: string, limit: number) => {
    const count = (hits.get(key) ?? 0) + 1;
    hits.set(key, count);
    return { allowed: count <= limit, count };
  }),
}));

const { checkAuthAttempt, emailKey, limitsFor } = await import("@/lib/authAbuse");

beforeEach(() => {
  hits.clear();
});

describe("emailKey", () => {
  it("never returns the raw address", () => {
    const email = "debater@school.edu";
    const key = emailKey(email);
    expect(key).not.toContain(email);
    expect(key).not.toContain("school.edu");
  });

  it("is stable for the same address and different for another", () => {
    expect(emailKey("a@b.com")).toBe(emailKey("a@b.com"));
    expect(emailKey("a@b.com")).not.toBe(emailKey("c@d.com"));
  });

  it("treats case and surrounding whitespace as the same address", () => {
    // Otherwise "A@B.com " would get a fresh quota from the same inbox.
    expect(emailKey("  Debater@School.edu ")).toBe(emailKey("debater@school.edu"));
  });
});

describe("checkAuthAttempt", () => {
  it("allows a first attempt", async () => {
    const d = await checkAuthAttempt("signup", "new@school.edu", "1.2.3.4");
    expect(d.allowed).toBe(true);
  });

  it("blocks once one address exceeds its own cap", async () => {
    const { perEmail } = limitsFor("signup");
    let last = await checkAuthAttempt("signup", "same@school.edu", "1.2.3.4");
    for (let i = 1; i < perEmail.max + 1; i++) {
      last = await checkAuthAttempt("signup", "same@school.edu", "1.2.3.4");
    }
    expect(last.allowed).toBe(false);
    expect(last.tripped).toBe("email");
  });

  it("keeps per-email counters independent, so one user can't block another", async () => {
    const { perEmail } = limitsFor("signup");
    for (let i = 0; i <= perEmail.max; i++) {
      await checkAuthAttempt("signup", "heavy@school.edu", "1.2.3.4");
    }
    // A different address from the SAME network still gets through: the IP caps
    // are much higher than the per-email one by design.
    const other = await checkAuthAttempt("signup", "innocent@school.edu", "1.2.3.4");
    expect(other.allowed).toBe(true);
  });

  it("blocks a network that exceeds its hourly cap across many addresses", async () => {
    const { perIpHour } = limitsFor("signup");
    let last = await checkAuthAttempt("signup", "u0@school.edu", "9.9.9.9");
    for (let i = 1; i <= perIpHour.max; i++) {
      last = await checkAuthAttempt("signup", `u${i}@school.edu`, "9.9.9.9");
    }
    expect(last.allowed).toBe(false);
    expect(last.tripped).toBe("ip-hour");
  });

  it("does not auto-ban merely for hitting the daily cap", async () => {
    // A confused user retrying is not an attacker. Banning at the cap would lock
    // out a whole school NAT over ordinary mistakes.
    const { perIpDay } = limitsFor("signup");
    hits.set("auth:signup:id:5.5.5.5", perIpDay.max);
    const d = await checkAuthAttempt("signup", "x@school.edu", "5.5.5.5");
    expect(d.allowed).toBe(false);
    expect(d.shouldBan).toBeFalsy();
  });

  it("auto-bans only far past the daily cap", async () => {
    const { banThresholdPerDay } = limitsFor("signup");
    hits.set("auth:signup:id:6.6.6.6", banThresholdPerDay);
    const d = await checkAuthAttempt("signup", "y@school.edu", "6.6.6.6");
    expect(d.allowed).toBe(false);
    expect(d.shouldBan).toBe(true);
  });

  it("gives a user-facing message that doesn't reveal which limit tripped", async () => {
    const { perEmail } = limitsFor("resend");
    let last = await checkAuthAttempt("resend", "r@school.edu", "1.1.1.1");
    for (let i = 0; i <= perEmail.max; i++) {
      last = await checkAuthAttempt("resend", "r@school.edu", "1.1.1.1");
    }
    expect(last.allowed).toBe(false);
    expect(last.error).toBeTruthy();
    expect(last.error).not.toMatch(/redis|counter|threshold|perEmail/i);
  });

  it("tracks each kind separately, so a resend doesn't consume signup budget", async () => {
    const { perEmail } = limitsFor("signup");
    for (let i = 0; i <= perEmail.max; i++) {
      await checkAuthAttempt("signup", "z@school.edu", "2.2.2.2");
    }
    const resend = await checkAuthAttempt("resend", "z@school.edu", "2.2.2.2");
    expect(resend.allowed).toBe(true);
  });
});
