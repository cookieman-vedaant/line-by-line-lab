import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ban check runs in front of EVERY guarded API route, so its caching
 * behavior is a hot-path concern, not an optimization detail. These tests pin
 * the three properties that matter:
 *
 *  1. It fails OPEN — an unreachable ban list must never lock users out.
 *  2. A missing table latches the check off instead of retrying forever (this
 *     regressed once: 45 requests produced 45 doomed lookups).
 *  3. Results are cached in-process, so a request doesn't pay a round trip when
 *     Redis isn't configured.
 */

const state = vi.hoisted(() => ({
  queryCount: 0,
  response: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/lib/redis", () => ({
  // Force the no-Redis path: that's where the per-request DB cost showed up.
  getRedis: () => null,
  hasRedis: () => false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            state.queryCount += 1;
            return state.response;
          },
        }),
      }),
    }),
  }),
}));

beforeEach(() => {
  state.queryCount = 0;
  state.response = { data: null, error: null };
  vi.resetModules();
});

async function freshModule() {
  // Re-import per test so the module-level "table missing" latch starts clean.
  return await import("@/lib/ipBan");
}

describe("normalizeIp", () => {
  it("trims and lowercases so one client can't look like two", async () => {
    const { normalizeIp } = await freshModule();
    expect(normalizeIp("  1.2.3.4 ")).toBe("1.2.3.4");
    expect(normalizeIp("2600:AB::1")).toBe("2600:ab::1");
  });
});

describe("isIpBanned", () => {
  it("returns false for an unknown IP without querying", async () => {
    const { isIpBanned } = await freshModule();
    expect(await isIpBanned("unknown")).toBe(false);
    expect(await isIpBanned("")).toBe(false);
    expect(state.queryCount).toBe(0);
  });

  it("reports a permanent ban (null expiry) as banned", async () => {
    const { isIpBanned } = await freshModule();
    state.response = { data: { ip: "9.9.9.9", expires_at: null }, error: null };
    expect(await isIpBanned("9.9.9.9")).toBe(true);
  });

  it("treats an expired ban as not banned", async () => {
    const { isIpBanned } = await freshModule();
    state.response = {
      data: { ip: "8.8.8.8", expires_at: new Date(Date.now() - 60_000).toISOString() },
      error: null,
    };
    expect(await isIpBanned("8.8.8.8")).toBe(false);
  });

  it("honors a ban that has not yet expired", async () => {
    const { isIpBanned } = await freshModule();
    state.response = {
      data: { ip: "7.7.7.7", expires_at: new Date(Date.now() + 60_000).toISOString() },
      error: null,
    };
    expect(await isIpBanned("7.7.7.7")).toBe(true);
  });

  it("caches in-process, so repeat checks don't re-query", async () => {
    const { isIpBanned } = await freshModule();
    for (let i = 0; i < 10; i++) await isIpBanned("1.1.1.1");
    // Without the L1 cache and no Redis, this would be 10 round trips on the
    // hot path of every API route.
    expect(state.queryCount).toBe(1);
  });

  it("latches OFF when the table is missing, instead of retrying every request", async () => {
    const { isIpBanned } = await freshModule();
    state.response = {
      data: null,
      error: { code: "PGRST205", message: "Could not find the table 'public.ip_bans'" },
    };
    for (let i = 0; i < 10; i++) {
      // Distinct IPs so the per-IP cache can't be what's suppressing queries.
      expect(await isIpBanned(`10.0.0.${i}`)).toBe(false);
    }
    expect(state.queryCount).toBe(1);
  });

  it("fails OPEN on an ordinary lookup error", async () => {
    const { isIpBanned } = await freshModule();
    state.response = { data: null, error: { code: "57014", message: "statement timeout" } };
    // A ban list that can't be read must not deny access to everyone.
    expect(await isIpBanned("4.4.4.4")).toBe(false);
  });

  it("keeps querying after a transient error (does not latch on non-missing-table errors)", async () => {
    const { isIpBanned } = await freshModule();
    state.response = { data: null, error: { code: "57014", message: "statement timeout" } };
    await isIpBanned("5.5.5.1");
    await isIpBanned("5.5.5.2");
    expect(state.queryCount).toBe(2);
  });
});
