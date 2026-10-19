import { describe, expect, it } from "vitest";
import {
  currentSeasonYear,
  dropKnown,
  isRetryableWriteError,
  parseCardCap,
  planRefresh,
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

/*
 * Measured 2026-10-18: the weekly refresh pulled the newest 4 archives of every
 * current-season caselist inside ONE 300s function, in API order. Mid-season
 * archives are 100-760 MB and the database saves ~4 cards/s, so each run died
 * inside the first caselist (hspolicy26): hsld26 got nothing after Sep 14,
 * hspf26 after Aug 17, nfald26 never — and every week a run didn't finish slid
 * out of the newest-4 window for good. The refresh now works from a record of
 * finished archives instead of a window.
 */
describe("planRefresh", () => {
  const listing = [
    { caselist: "hspolicy26", archives: ["hspolicy26-weekly-2026-10-06.zip", "hspolicy26-weekly-2026-10-13.zip", "hspolicy26-all-2026-10-13.zip"] },
    { caselist: "hsld26", archives: ["hsld26-weekly-2026-10-13.zip", "hsld26-weekly-2026-10-06.zip", "hsld26-weekly-2026-07-07.zip"] },
    { caselist: "nfald26", archives: ["nfald26-weekly-2026-10-13.zip"] },
  ].map((c) => ({ caselist: c.caselist, archives: c.archives.map((name) => ({ name, url: `https://s3/${name}` })) }));

  it("takes the newest week of EVERY caselist before any older week", () => {
    expect(planRefresh(listing, new Set()).map((a) => a.name)).toEqual([
      "hspolicy26-weekly-2026-10-13.zip",
      "hsld26-weekly-2026-10-13.zip",
      "nfald26-weekly-2026-10-13.zip",
      "hspolicy26-weekly-2026-10-06.zip",
      "hsld26-weekly-2026-10-06.zip",
      "hsld26-weekly-2026-07-07.zip",
    ]);
  });

  it("skips archives already finished — however old — and never the cumulative -all- file", () => {
    const done = new Set(["hspolicy26-weekly-2026-10-13.zip", "hsld26-weekly-2026-07-07.zip"]);
    const names = planRefresh(listing, done).map((a) => a.name);
    expect(names).not.toContain("hspolicy26-weekly-2026-10-13.zip");
    expect(names).not.toContain("hsld26-weekly-2026-07-07.zip");
    expect(names.some((n) => n.includes("-all-"))).toBe(false);
    expect(names).toContain("hsld26-weekly-2026-10-06.zip");
  });

  it("carries the caselist and download url with each archive", () => {
    expect(planRefresh(listing, new Set())[1]).toEqual({
      caselist: "hsld26",
      name: "hsld26-weekly-2026-10-13.zip",
      url: "https://s3/hsld26-weekly-2026-10-13.zip",
    });
  });
});

describe("parseCardCap", () => {
  it("reads a cap written with thousands separators", () => {
    // .env.local had WIKI_MAX_CARDS="600,000", which Number() reads as NaN —
    // silently turning the storage cap off.
    expect(parseCardCap("600,000")).toBe(600_000);
    expect(parseCardCap("1_500_000")).toBe(1_500_000);
    expect(parseCardCap(" 250000 ")).toBe(250_000);
  });

  it("falls back to the default for anything that isn't a positive number", () => {
    for (const raw of [undefined, "", "lots", "-5", "0"]) expect(parseCardCap(raw), String(raw)).toBe(400_000);
  });
});

describe("dropKnown", () => {
  it("keeps only cards the index doesn't already hold", () => {
    const batch = [{ content_hash: "a" }, { content_hash: "b" }, { content_hash: "c" }];
    expect(dropKnown(batch, new Set(["b"])).map((r) => r.content_hash)).toEqual(["a", "c"]);
  });
});
