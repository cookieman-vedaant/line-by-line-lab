import { describe, expect, it } from "vitest";
import {
  dedupeCandidates,
  isFetchableUrl,
  pickWorkUrl,
  publicationAgeToFromDate,
  reconstructAbstract,
  semanticScholarUrls,
  workUrls,
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

describe("isFetchableUrl", () => {
  it("accepts ordinary http(s) article links", () => {
    expect(isFetchableUrl("https://escholarship.org/uc/item/2n68698q")).toBe(true);
    expect(isFetchableUrl("http://eprints.lse.ac.uk/43153/1/report.pdf")).toBe(true);
  });

  it("rejects the junk OpenAlex sometimes stores as a landing page", () => {
    // Seen live: a best_oa_location whose "landing page" was an ORCID profile
    // with scraped markup glued on. Fetching it can only ever fail.
    expect(isFetchableUrl("https://orcid.org/0000-0001-9395-6754>,")).toBe(false);
    expect(isFetchableUrl("https://orcid.org/0000-0001-9395-6754")).toBe(false);
    expect(isFetchableUrl("https://example.org/a b")).toBe(false);
    expect(isFetchableUrl("ftp://example.org/paper.pdf")).toBe(false);
    expect(isFetchableUrl("not a url")).toBe(false);
    expect(isFetchableUrl("")).toBe(false);
    expect(isFetchableUrl(undefined)).toBe(false);
  });
});

describe("workUrls", () => {
  it("keeps the free PDF as an alternate behind a DOI landing page", () => {
    // The live case behind "not enough full text": 14 of 20 open-access works
    // were offered by their DOI/landing page — often a paywalled or bot-blocked
    // publisher page — while a free PDF sat unused in the same record.
    const urls = workUrls({
      best_oa_location: {
        landing_page_url: "https://doi.org/10.1257/jep.32.4.201",
        pdf_url: "https://www.aeaweb.org/articles/pdf/doi/10.1257/jep.32.4.201",
      },
      primary_location: { landing_page_url: "https://doi.org/10.1257/jep.32.4.201" },
      doi: "https://doi.org/10.1257/jep.32.4.201",
    });
    expect(urls).toEqual([
      "https://doi.org/10.1257/jep.32.4.201",
      "https://www.aeaweb.org/articles/pdf/doi/10.1257/jep.32.4.201",
    ]);
  });

  it("adds other open-access copies (repositories) and never repeats a URL", () => {
    const urls = workUrls({
      best_oa_location: { landing_page_url: "https://pub.org/a", pdf_url: "https://pub.org/a.pdf" },
      locations: [
        { is_oa: true, landing_page_url: "https://repo.edu/item/1", pdf_url: "https://repo.edu/item/1.pdf" },
        { is_oa: false, landing_page_url: "https://paywalled.com/a" },
        { is_oa: true, landing_page_url: "https://pub.org/a" },
      ],
      primary_location: { landing_page_url: "https://pub.org/a" },
      doi: "https://doi.org/10.1/a",
    });
    expect(urls).toEqual([
      "https://pub.org/a",
      "https://pub.org/a.pdf",
      "https://repo.edu/item/1.pdf",
      "https://repo.edu/item/1",
      "https://doi.org/10.1/a",
    ]);
    expect(urls).not.toContain("https://paywalled.com/a");
  });

  it("skips a junk landing page and leads with the PDF instead", () => {
    const urls = workUrls({
      best_oa_location: {
        landing_page_url: "https://orcid.org/0000-0001-9395-6754>,",
        pdf_url: "https://eprints.whiterose.ac.uk/73187/1/Document.pdf",
      },
    });
    expect(urls[0]).toBe("https://eprints.whiterose.ac.uk/73187/1/Document.pdf");
    expect(pickWorkUrl({
      best_oa_location: {
        landing_page_url: "https://orcid.org/0000-0001-9395-6754>,",
        pdf_url: "https://eprints.whiterose.ac.uk/73187/1/Document.pdf",
      },
    })).toBe("https://eprints.whiterose.ac.uk/73187/1/Document.pdf");
  });
});

describe("semanticScholarUrls", () => {
  it("leads with the open-access PDF, keeping the S2 page as an alternate", () => {
    expect(
      semanticScholarUrls({
        url: "https://www.semanticscholar.org/paper/abc",
        openAccessPdf: { url: "https://arxiv.org/pdf/2101.00001", status: "GREEN" },
      }),
    ).toEqual(["https://arxiv.org/pdf/2101.00001", "https://www.semanticscholar.org/paper/abc"]);
  });

  it("ignores an empty openAccessPdf url (S2 returns these for closed papers)", () => {
    expect(
      semanticScholarUrls({
        url: "https://www.semanticscholar.org/paper/abc",
        openAccessPdf: { url: "", status: "CLOSED" },
      }),
    ).toEqual(["https://www.semanticscholar.org/paper/abc"]);
  });
});

describe("dedupeCandidates — full-text alternates", () => {
  const base: CandidateArticle = {
    title: "Universal Basic Income in the United States",
    authors: ["H. Hoynes"],
    venue: "Annual Review of Economics",
    date: "2019-01-01",
    url: "https://doi.org/10.1146/annurev-economics-080218-030237",
    abstract: "short",
    citationCount: 100,
    source: "openalex",
    fullTextUrls: ["https://escholarship.org/content/qt2n68698q/qt2n68698q.pdf"],
  };

  it("keeps every place the full text might live when two databases return the same work", () => {
    const fromS2: CandidateArticle = {
      ...base,
      source: "semanticscholar",
      url: "https://arxiv.org/pdf/1234.5678",
      abstract: "a much richer abstract than the other one",
      fullTextUrls: ["https://www.semanticscholar.org/paper/xyz"],
    };
    const [merged] = dedupeCandidates([base, fromS2]);
    expect(merged.url).toBe("https://arxiv.org/pdf/1234.5678");
    expect(merged.fullTextUrls).toEqual([
      "https://www.semanticscholar.org/paper/xyz",
      "https://doi.org/10.1146/annurev-economics-080218-030237",
      "https://escholarship.org/content/qt2n68698q/qt2n68698q.pdf",
    ]);
  });
});

describe("dedupeCandidates — generic titles", () => {
  const work = (over: Partial<CandidateArticle>): CandidateArticle => ({
    title: "Introduction",
    authors: ["A. Smith"],
    venue: "J",
    date: "2020-01-01",
    url: "https://a.org/1",
    abstract: "x",
    citationCount: 0,
    source: "openalex",
    ...over,
  });

  it("keeps two unrelated works that merely share a generic title apart", () => {
    const out = dedupeCandidates([work({}), work({ authors: ["B. Jones"], url: "https://b.org/2", date: "2015" })]);
    expect(out).toHaveLength(2);
    expect(out[0].fullTextUrls ?? []).not.toContain("https://b.org/2");
  });

  it("still merges the same generic-titled work seen twice", () => {
    expect(dedupeCandidates([work({}), work({ url: "https://mirror.org/1" })])).toHaveLength(1);
  });
});
