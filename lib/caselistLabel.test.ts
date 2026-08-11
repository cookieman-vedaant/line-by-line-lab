import { describe, expect, it } from "vitest";
import { caselistLabel, caselistOptionLabel } from "@/lib/caselistLabel";

/*
 * These are the thirteen slugs actually in the index (measured 2026-08-10), so
 * the table covers what a debater will really see rather than invented cases.
 */
describe("caselistLabel", () => {
  it("names the divisions in the index", () => {
    expect(caselistLabel("hsld25")).toBe("HS LD 2025-26");
    expect(caselistLabel("hspf24")).toBe("HS PF 2024-25");
    expect(caselistLabel("hspolicy25")).toBe("HS Policy 2025-26");
    expect(caselistLabel("ndtceda24")).toBe("College Policy 2024-25");
    expect(caselistLabel("nfald25")).toBe("College LD 2025-26");
  });

  /*
   * "hspolicy" starts with neither "hsld" nor "hspf", but a careless prefix
   * table ordered the other way would still need to not match "hsp"-ish
   * fragments. Pinning it keeps a future edit from silently mislabelling the
   * second-largest caselist.
   */
  it("does not confuse hspolicy with the other hs divisions", () => {
    expect(caselistLabel("hspolicy24")).toBe("HS Policy 2024-25");
    expect(caselistLabel("hspolicy24")).not.toContain("PF");
    expect(caselistLabel("hspf26")).toBe("HS PF 2026-27");
  });

  it("rolls the season over the century correctly", () => {
    expect(caselistLabel("hsld99")).toBe("HS LD 2099-00");
  });

  /*
   * Ingestion adds caselists on its own. Guessing a name for one we do not
   * recognise would put an invented label in a UI whose promise is that
   * everything shown is real, so an unknown slug passes through untouched.
   */
  it("passes an unrecognised slug through unchanged", () => {
    expect(caselistLabel("worldschools25")).toBe("worldschools25");
    expect(caselistLabel("hsld")).toBe("hsld");
    expect(caselistLabel("hsld2025")).toBe("hsld2025");
    expect(caselistLabel("")).toBe("");
  });
});

describe("caselistOptionLabel", () => {
  it("keeps the raw slug visible, since opencaselist itself uses it", () => {
    expect(caselistOptionLabel("hsld25", 58488)).toBe("HS LD 2025-26 (hsld25) · 58,488 cards");
  });

  it("does not repeat the slug when there is no friendlier name", () => {
    expect(caselistOptionLabel("worldschools25", 12)).toBe("worldschools25 · 12 cards");
  });
});
