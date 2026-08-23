import { describe, expect, it } from "vitest";
import { articlesFromRanking } from "./articleFinder";
import type { CandidateArticle } from "./academicSearch";

/**
 * The bug this file exists to prevent:
 *
 * The ranker is allowed to answer "none of these relate to the claim", and on a
 * narrowly worded claim it regularly did — retrieval had found forty real
 * articles about the subject, none arguing that exact sentence. The pipeline
 * turned that opinion into NoSourcesFoundError, so the app told debaters no
 * reputable sources existed while forty of them sat in the shortlist. The more
 * precise the claim, the more reliably it happened.
 */
function candidate(i: number, over: Partial<CandidateArticle> = {}): CandidateArticle {
  return {
    title: `Article ${i}`,
    authors: [`Author ${i}`],
    url: `https://example.org/${i}`,
    venue: "Journal of Testing",
    source: "openalex",
    date: "2024-01-01",
    citationCount: 10 * i,
    abstract: `Abstract for article ${i}.`,
    ...over,
  } as CandidateArticle;
}

const shortlist = [candidate(1), candidate(2), candidate(3)];

describe("articlesFromRanking", () => {
  it("returns the ranker's picks, in its order, with its explanations", () => {
    const out = articlesFromRanking(
      [
        { index: 2, explanation: "carries the impact", credibilityScore: 90 },
        { index: 0, explanation: "carries the link", credibilityScore: 70 },
      ],
      shortlist,
    );
    expect(out.map((a) => a.title)).toEqual(["Article 3", "Article 1"]);
    expect(out[0].explanation).toBe("carries the impact");
    expect(out[0].credibilityScore).toBe(90);
  });

  it("still returns real articles when the ranker selects NONE", () => {
    // The regression. Retrieval found these; an empty ranking must not be
    // reported to the debater as "no reputable sources were found".
    const out = articlesFromRanking([], shortlist);
    expect(out.length).toBeGreaterThan(0);
    expect(out.map((a) => a.url).sort()).toEqual(shortlist.map((c) => c.url).sort());
  });

  it("falls back when every selected index is out of range", () => {
    const out = articlesFromRanking(
      [{ index: 99, explanation: "hallucinated pick", credibilityScore: 50 }],
      shortlist,
    );
    expect(out.length).toBeGreaterThan(0);
  });

  it("drops only the out-of-range picks when some are valid", () => {
    const out = articlesFromRanking(
      [
        { index: 1, explanation: "real pick", credibilityScore: 80 },
        { index: 42, explanation: "hallucinated pick", credibilityScore: 80 },
        { index: -1, explanation: "negative index", credibilityScore: 80 },
      ],
      shortlist,
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Article 2");
  });

  it("never invents an article that wasn't retrieved", () => {
    const urls = new Set(shortlist.map((c) => c.url));
    for (const selections of [[], [{ index: 0, explanation: "x", credibilityScore: 1 }]]) {
      for (const article of articlesFromRanking(selections, shortlist)) {
        expect(urls.has(article.url)).toBe(true);
      }
    }
  });
});
