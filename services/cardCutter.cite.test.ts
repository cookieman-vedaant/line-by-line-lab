import { describe, expect, it } from "vitest";
import { mergeCiteFacts } from "./cardCutter";
import type { ExtractedArticle } from "./articleExtract";

/**
 * The cite is assembled from two sources of truth: the search result the
 * debater clicked, and the page itself. Getting the precedence wrong between
 * them is what produced the reported symptoms — cites naming the outlet
 * instead of the author, and cites carrying the wrong year.
 */
function page(over: Partial<ExtractedArticle> = {}): ExtractedArticle {
  return {
    title: "Real Page Title",
    author: "Tim Stelloh",
    publication: "NBC News",
    date: "2025-08-07",
    text: "body",
    authors: ["Tim Stelloh"],
    authorQualification: "",
    publisherQualification: "",
    canonicalUrl: "https://example.org/a",
    ...over,
  };
}

describe("mergeCiteFacts", () => {
  it("keeps the page's byline over the search result's", () => {
    // Web results carry the HOSTNAME in the author field. It used to win.
    const out = mergeCiteFacts(page(), { url: "u", author: "nbcnews.com" });
    expect(out.authors).toEqual(["Tim Stelloh"]);
    expect(out.author).toBe("Tim Stelloh");
  });

  it("never turns a bare hostname into an author", () => {
    const out = mergeCiteFacts(page({ authors: [], author: "" }), {
      url: "u",
      author: "nbcnews.com",
    });
    expect(out.authors).toEqual([]);
    expect(out.author).toBe("");
  });

  it("uses the search result's authors when the page states none", () => {
    const out = mergeCiteFacts(page({ authors: [], author: "" }), {
      url: "u",
      authors: ["Daron Acemoglu", "Pascual Restrepo"],
    });
    expect(out.authors).toEqual(["Daron Acemoglu", "Pascual Restrepo"]);
  });

  it("takes the most recent date, not whichever side was asked first", () => {
    // The database's publication date is often older than the page's own
    // updated date; a debater cites the version they can read.
    const out = mergeCiteFacts(page({ date: "2025-08-07" }), {
      url: "u",
      date: "2021-01-01",
    });
    expect(out.date).toBe("2025-08-07");
  });

  it("ignores a non-date like 'unknown' instead of citing it", () => {
    // candidateToArticle used to emit the literal string "unknown", which then
    // beat the real date because it was truthy.
    const out = mergeCiteFacts(page(), { url: "u", date: "unknown" });
    expect(out.date).toBe("2025-08-07");
  });

  it("falls back to the database's affiliations for qualifications", () => {
    const out = mergeCiteFacts(page(), {
      url: "u",
      authorInstitutions: ["Massachusetts Institute of Technology"],
    });
    expect(out.authorQualification).toBe("Massachusetts Institute of Technology");
  });

  it("prefers what the page itself says about the author", () => {
    const out = mergeCiteFacts(page({ authorQualification: "Breaking news reporter" }), {
      url: "u",
      authorInstitutions: ["Some University"],
    });
    expect(out.authorQualification).toBe("Breaking news reporter");
  });

  it("keeps a truncated 'et al.' from a search result", () => {
    const out = mergeCiteFacts(page({ authors: [], author: "" }), {
      url: "u",
      author: "Alhussein Fawzi et al.",
    });
    expect(out.etAl).toBe(true);
  });
});
