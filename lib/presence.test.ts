import { describe, expect, it, vi } from "vitest";
import { countOnline, onlineCutoffIso } from "@/lib/presence";

describe("onlineCutoffIso", () => {
  it("returns the ISO timestamp `windowMs` before `now`", () => {
    const now = Date.parse("2026-07-31T12:00:40.000Z");
    expect(onlineCutoffIso(now, 40_000)).toBe("2026-07-31T12:00:00.000Z");
  });
});

describe("countOnline", () => {
  // A minimal stub of the Supabase query builder chain the function uses:
  // .from(...).select(..., { head, count }).gt(...)  →  { count, error }
  function stubAdmin(result: { count: number | null; error: { message: string } | null }) {
    const gt = vi.fn().mockResolvedValue(result);
    const select = vi.fn().mockReturnValue({ gt });
    const from = vi.fn().mockReturnValue({ select });
    // Cast through unknown — we only exercise the exact chain above.
    return { client: { from } as unknown as Parameters<typeof countOnline>[0], from, select, gt };
  }

  it("counts rows active within the window (last_seen > cutoff)", async () => {
    const now = Date.parse("2026-07-31T12:00:40.000Z");
    const { client, gt } = stubAdmin({ count: 3, error: null });
    expect(await countOnline(client, now)).toBe(3);
    // Filters on the correct cutoff so stale rows are excluded.
    expect(gt).toHaveBeenCalledWith("last_seen", "2026-07-31T12:00:00.000Z");
  });

  it("returns 0 when the count comes back null but there's no error", async () => {
    const { client } = stubAdmin({ count: null, error: null });
    expect(await countOnline(client)).toBe(0);
  });

  it("returns null (not a throw) on a DB error", async () => {
    const { client } = stubAdmin({ count: null, error: { message: "boom" } });
    expect(await countOnline(client)).toBeNull();
  });
});
