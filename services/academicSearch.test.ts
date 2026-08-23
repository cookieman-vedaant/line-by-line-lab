import { describe, expect, it } from "vitest";
import {
  dedupeCandidates,
  pickWorkUrl,
  publicationAgeToFromDate,
  reconstructAbstract,
  type CandidateArticle,
} from "./academicSearch";

describe("reconstructAbstract", () => {
  it("rebuilds text from an inverted index", () => {
    const inverted = {
      Sanctions: [0],
      often: [1],
      fail: [2],
      against: [3],
      autocracies: [4],
    };
    expect(reconstructAbstract(inverted)).toBe("Sanctions often fail against autocracies");
  });

  it("handles repeated words at multiple positions", () => {
    const inverted = { the: [0, 3], cat: [1], sat: [2], mat: [4] };
    expect(reconstructAbstract(inverted)).toBe("the cat sat the mat");
  });

  it("returns empty string for null/undefined", () => {
    expect(reconstructAbstract(null)).toBe("");
    expect(reconstructAbstract(undefined)).toBe("");
  });
});

describe("publicationAgeToFromDate", () => {
  const today = new Date("2026-07-04T12:00:00Z");

  it("returns null for Any or undefined", () => {
    expect(publicationAgeToFromDate("Any", today)).toBeNull();
    expect(publicationAgeToFromDate(undefined, today)).toBeNull();
  });

  it("maps ages to from-dates", () => {
    expect(publicationAgeToFromDate("6 months", today)).toBe("2026-01-04");
    expect(publicationAgeToFromDate("1 year", today)).toBe("2025-07-04");
    expect(publicationAgeToFromDate("5 years", today)).toBe("2021-07-04");
  });
});

describe("dedupeCandidates", () => {
  const base: CandidateArticle = {
    title: "Sanctions and Authoritarian Survival",
    authors: ["A. Author"],
    venue: "Journal of Peace Research",
    date: "2025-03-01",
    url: "https://example.com/1",
    abstract: "short",
    citationCount: 10,
    source: "openalex",
  };

  it("keeps the duplicate with the richer abstract", () => {
    const richer = {
      ...base,
      url: "https://example.com/2",
      abstract: "a much longer and more useful abstract",
      source: "semanticscholar" as const,
    };
    const result = dedupeCandidates([base, richer]);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com/2");
  });

  it("treats punctuation/case variants of a title as the same work", () => {
    const variant = { ...base, title: "Sanctions and authoritarian survival!" };
    expect(dedupeCandidates([base, variant])).toHaveLength(1);
  });

  it("keeps genuinely different works", () => {
    const other = { ...base, title: "A Completely Different Paper" };
    expect(dedupeCandidates([base, other])).toHaveLength(2);
  });
});

describe("pickWorkUrl", () => {
  it("prefers an OA HTML landing page", () => {
    expect(
      pickWorkUrl({
        best_oa_location: { landing_page_url: "https://ex.org/full", pdf_url: "https://ex.org/f.pdf" },
        primary_location: { landing_page_url: "https://doi.org/x" },
        doi: "https://doi.org/x",
      }),
    ).toBe("https://ex.org/full");
  });

  it("returns the OA PDF instead of falling to the paywalled DOI", () => {
    // The fix: an OA work whose only OA location is a PDF used to yield the
    // paywalled DOI ("not full text"). We read PDFs now, so return the PDF.
    expect(
      pickWorkUrl({
        best_oa_location: { pdf_url: "https://repo.org/paper.pdf" },
        primary_location: { landing_page_url: "https://doi.org/10.1/x" },
        doi: "https://doi.org/10.1/x",
      }),
    ).toBe("https://repo.org/paper.pdf");
  });

  it("falls back to the DOI only when there is no OA location at all", () => {
    expect(
      pickWorkUrl({ primary_location: undefined, doi: "https://doi.org/10.1/y" }),
    ).toBe("https://doi.org/10.1/y");
  });
});
