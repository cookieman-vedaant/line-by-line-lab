import { describe, expect, it } from "vitest";
import {
  currentSeasonYear,
  isRetryableWriteError,
  provenanceFromPath,
  upsertInChunks,
  yearFromSlug,
} from "@/services/wikiIngest";

/** Minimal stand-in for a card row — upsertInChunks only ever counts them. */
function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ content_hash: String(i) }));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const write = (fn: (chunk: any[]) => Promise<{ error: { message: string } | null }>) => fn as any;
const noWait = async () => {};

describe("isRetryableWriteError", () => {
  it("treats a statement timeout as retryable — the documented backfill failure", () => {
    expect(isRetryableWriteError("canceling statement due to statement timeout")).toBe(true);
    expect(isRetryableWriteError("deadlock detected")).toBe(true);
  });

  it("does NOT retry a genuine defect, which would fail identically forever", () => {
    expect(isRetryableWriteError('column "tag" does not exist')).toBe(false);
    expect(isRetryableWriteError("violates not-null constraint")).toBe(false);
  });
});

describe("upsertInChunks", () => {
  it("writes every row when the database is healthy", async () => {
    const seen: number[] = [];
    const written = await upsertInChunks(
      rows(120) as never,
      write(async (chunk) => {
        seen.push(chunk.length);
        return { error: null };
      }),
      noWait,
    );

    expect(written).toBe(120);
    expect(seen).toEqual([50, 50, 20]);
  });

  /*
   * The whole point of the rewrite: a timeout used to throw away the entire
   * caselist. Now the chunk halves and the SAME rows are retried, so no work is
   * lost and the writer adapts to what the database will accept.
   */
  it("halves the chunk and keeps going after a statement timeout", async () => {
    const attempted: number[] = [];
    let failuresLeft = 2;

    const written = await upsertInChunks(
      rows(100) as never,
      write(async (chunk) => {
        attempted.push(chunk.length);
        if (failuresLeft > 0) {
          failuresLeft--;
          return { error: { message: "canceling statement due to statement timeout" } };
        }
        return { error: null };
      }),
      noWait,
    );

    expect(written).toBe(100);
    // 50 fails, 25 fails, then 12-row chunks carry the whole set through.
    expect(attempted.slice(0, 3)).toEqual([50, 25, 12]);
  });

  it("never shrinks below the floor, and gives up rather than looping forever", async () => {
    const attempted: number[] = [];

    await expect(
      upsertInChunks(
        rows(40) as never,
        write(async (chunk) => {
          attempted.push(chunk.length);
          return { error: { message: "statement timeout" } };
        }),
        noWait,
      ),
    ).rejects.toThrow(/upsert failed/);

    expect(Math.min(...attempted)).toBeGreaterThanOrEqual(5);
    expect(attempted.length).toBe(5);
  });

  it("surfaces a real defect immediately instead of retrying it", async () => {
    let calls = 0;

    await expect(
      upsertInChunks(
        rows(10) as never,
        write(async () => {
          calls++;
          return { error: { message: 'column "tag" does not exist' } };
        }),
        noWait,
      ),
    ).rejects.toThrow(/column "tag" does not exist/);

    expect(calls).toBe(1);
  });
});

describe("provenanceFromPath", () => {
  /*
   * Verified against a real weekly archive: entries are laid out as
   * caselist/school/team/file.docx, e.g.
   *   hsld24/MillardNorth/KyBl/MillardNorth-KyBl-Aff-1.docx
   * Reading school/team from the END gets this right whether or not the caselist
   * prefix is present — the earlier front-anchored version mislabeled the
   * caselist as the school.
   */
  it("reads school/team from the real caselist/school/team/file layout", () => {
    expect(provenanceFromPath("hsld24/MillardNorth/KyBl/MillardNorth-KyBl-Aff-1.docx")).toEqual({
      school: "MillardNorth",
      team: "KyBl",
    });
  });

  it("also handles a bare school/team/file layout", () => {
    expect(provenanceFromPath("Westminster/AB/1AC.docx")).toEqual({
      school: "Westminster",
      team: "AB",
    });
  });

  it("declines to attribute when the path is too shallow", () => {
    expect(provenanceFromPath("loose.docx")).toEqual({ school: null, team: null });
    expect(provenanceFromPath("team/file.docx")).toEqual({ school: null, team: null });
  });
});

describe("yearFromSlug", () => {
  it("reads the year from a caselist slug", () => {
    expect(yearFromSlug("hsld24")).toBe(2024);
    expect(yearFromSlug("hspolicy25")).toBe(2025);
    expect(yearFromSlug("openev-2024")).toBe(2024);
  });

  it("returns null when there's no year", () => {
    expect(yearFromSlug("ndtceda")).toBeNull();
  });
});

describe("currentSeasonYear", () => {
  // Debate seasons start in the fall, so the "active" season year rolls over in
  // August — that's what the weekly refresh uses to pick which caselists still
  // gain disclosures.
  it("uses the current year from August onward", () => {
    expect(currentSeasonYear(new Date("2026-08-01T00:00:00Z"))).toBe(2026);
    expect(currentSeasonYear(new Date("2026-12-31T00:00:00Z"))).toBe(2026);
  });

  it("uses the prior year before August (that season runs into spring)", () => {
    expect(currentSeasonYear(new Date("2026-07-31T00:00:00Z"))).toBe(2025);
    expect(currentSeasonYear(new Date("2026-01-15T00:00:00Z"))).toBe(2025);
  });
});
