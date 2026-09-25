import { describe, expect, it } from "vitest";
import { articlesFromRanking } from "./articleFinder";
import type { CandidateArticle } from "./academicSearch";

/**
 * History this file carries:
 *
 * 1. The ranker is allowed to answer "none of these relate to the claim", and on
 *    a narrowly worded claim it regularly did while forty on-subject articles
 *    sat in the shortlist. The fix then was to show those articles anyway,
 *    ordered by citations.
 *
 * 2. That fallback is exactly how debaters were handed articles with nothing to
 *    do with their claim — and cut power-tagged cards from them. So a JUDGED
 *    empty ranking now means what it says, and returns nothing. Narrow claims
 *    are protected where the problem actually was: the ranker prompt now counts
 *    a narrower, more general or one-step article as support, and the finder
 *    searches further before it gives up (see runSearch).
 *
 * A MALFORMED answer (every pick out of range) is still not a judgement about
 * relevance, and still falls back to non-AI ordering.
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

  it("returns nothing when the ranker judges that NONE of the candidates support the claim", () => {
    // Showing them anyway, by citation count, is how off-topic articles reached
    // the cutter. The caller searches further, then reports honestly.
    expect(articlesFromRanking([], shortlist)).toEqual([]);
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
    for (const selections of [
      [],
      [{ index: 0, explanation: "x", credibilityScore: 1 }],
      [{ index: 7, explanation: "hallucinated", credibilityScore: 1 }],
    ]) {
      for (const article of articlesFromRanking(selections, shortlist)) {
        expect(urls.has(article.url)).toBe(true);
      }
    }
  });

  it("does not hand web snippets to the cutter as abstracts", () => {
    // A search engine's snippet is stitched fragments, not the author's
    // abstract; the cutter must never cut a card from it.
    const web = candidate(9, { source: "web", abstract: "snippet … from a page" });
    const [out] = articlesFromRanking([{ index: 0, explanation: "x", credibilityScore: 50 }], [web]);
    expect(out.abstract).toBeUndefined();
  });
});
