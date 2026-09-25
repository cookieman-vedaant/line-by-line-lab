import { describe, expect, it } from "vitest";
import type { CandidateArticle } from "./academicSearch";
import {
  cleanExpansions,
  emptyResultMessage,
  interleave,
  keywordRanking,
  selectResults,
  settleBy,
  verifyOrder,
  type Pick,
} from "./articleFinder";
import type { Article } from "@/types";

function candidate(title: string, over: Partial<CandidateArticle> = {}): CandidateArticle {
  return {
    title,
    authors: ["A. Author"],
    venue: "Journal",
    date: "2024-01-01",
    url: `https://example.org/${encodeURIComponent(title)}`,
    abstract: `Abstract of ${title}.`,
    citationCount: 10,
    source: "openalex",
    ...over,
  };
}

function article(url: string, over: Partial<Article> = {}): Article {
  return {
    title: url,
    author: "A",
    url,
    publication: "J",
    date: "2024",
    explanation: "x",
    credibilityScore: 70,
    abstract: "a".repeat(600),
    ...over,
  };
}

describe("interleave", () => {
  it("takes the best hit of every bucket before the second-best of any", () => {
    const out = interleave([
      [candidate("q1-a"), candidate("q1-b"), candidate("q1-c")],
      [candidate("q2-a")],
      [candidate("web-a"), candidate("web-b")],
    ]);
    expect(out.map((c) => c.title)).toEqual(["q1-a", "q2-a", "web-a", "q1-b", "web-b", "q1-c"]);
  });
});

describe("verifyOrder", () => {
  it("tries the result's own URLs, DOIs last, and never a search engine's paper page", () => {
    const c = candidate("x", {
      url: "https://doi.org/10.1/x",
      fullTextUrls: [
        "https://repo.edu/x.pdf",
        "https://www.semanticscholar.org/paper/abc",
        "https://publisher.com/x",
      ],
    });
    expect(verifyOrder(c)).toEqual([
      "https://repo.edu/x.pdf",
      "https://publisher.com/x",
      "https://doi.org/10.1/x",
    ]);
  });

  it("drops alternates on non-citable domains, which filterReputable never saw", () => {
    const c = candidate("x", {
      url: "https://journal.org/x",
      fullTextUrls: ["https://www.reddit.com/r/x", "https://en.wikipedia.org/wiki/X"],
    });
    expect(verifyOrder(c)).toEqual(["https://journal.org/x"]);
  });
});

describe("selectResults", () => {
  const full = (n: number) => Array.from({ length: n }, (_, i) => article(`https://full.org/${i}`));
  const abstractPick = (
    url: string,
    fit: Pick["fit"],
    abstractChars = 600,
    credibilityScore = 90,
  ): { article: Article; fit: Pick["fit"] } => ({
    article: article(url, { abstract: "a".repeat(abstractChars), credibilityScore }),
    fit,
  });

  it("shows high-credibility papers it couldn't open alongside full text, labelled", () => {
    const out = selectResults(full(4), [abstractPick("https://abs.org/nber", "strong", 600, 92)]);
    expect(out).toHaveLength(5);
    const paper = out.find((a) => a.url === "https://abs.org/nber");
    expect(paper?.accessible).toBe(false);
    expect(out.filter((a) => a.accessible)).toHaveLength(4);
  });

  it("puts high credibility first, and full text first within the same credibility", () => {
    const out = selectResults(
      [article("https://blog.org/medium", { credibilityScore: 62 }), article("https://nber.org/full", { credibilityScore: 85 })],
      [abstractPick("https://aer.org/abs", "partial", 600, 90)],
    );
    expect(out.map((a) => a.url)).toEqual(["https://nber.org/full", "https://aer.org/abs", "https://blog.org/medium"]);
  });

  it("offers only abstracts the cutter could use: high credibility, judged relevant, long enough", () => {
    const out = selectResults(full(1), [
      abstractPick("https://abs.org/medium-cred", "strong", 600, 65),
      abstractPick("https://abs.org/unjudged", undefined, 600, 90),
      abstractPick("https://abs.org/short", "strong", 120, 90),
      abstractPick("https://abs.org/partial", "partial", 600, 88),
    ]);
    expect(out.map((a) => a.url)).toEqual(["https://full.org/0", "https://abs.org/partial"]);
  });

  it("never lets two results share a URL (a swap can land two on one PDF)", () => {
    const dupe = [article("https://same.pdf"), article("https://same.pdf"), article("https://other.pdf"), article("https://third.pdf")];
    expect(selectResults(dupe, []).map((a) => a.url)).toEqual([
      "https://same.pdf",
      "https://other.pdf",
      "https://third.pdf",
    ]);
  });

  it("caps the list", () => {
    expect(selectResults(full(25), []).length).toBeLessThanOrEqual(12);
  });
});

describe("keywordRanking (the ranker is rate-limited)", () => {
  it("orders by how much of the claim an article is actually about, not by citations", () => {
    const pool = [
      candidate("Flood exposure and poverty", { citationCount: 9000, abstract: "Floods and poverty across countries." }),
      candidate("Universal basic income and poverty reduction", {
        citationCount: 12,
        abstract: "A universal basic income reduces poverty in pilot programs.",
      }),
    ];
    const out = keywordRanking("Universal basic income reduces poverty", pool);
    expect(out[0].article.title).toBe("Universal basic income and poverty reduction");
    expect(out[0].article.explanation).toMatch(/isn't verified/);
  });
});

describe("cleanExpansions", () => {
  it("keeps short distinct keyword queries and drops repeats of the base queries", () => {
    expect(
      cleanExpansions(
        ["unconditional cash transfers poverty", "Universal basic income reduces poverty", "", "a", "UBI pilot outcomes \"Kenya\""],
        ["Universal basic income reduces poverty"],
      ),
    ).toEqual(["unconditional cash transfers poverty", "UBI pilot outcomes Kenya"]);
  });
});

describe("settleBy", () => {
  it("returns what has arrived by the deadline and leaves stragglers empty", async () => {
    const fast = Promise.resolve(["fast"]);
    const slow = new Promise<string[]>((r) => setTimeout(() => r(["slow"]), 300));
    const failing = Promise.reject(new Error("down"));
    const out = await settleBy([fast, slow, failing], Date.now() + 50, [] as string[]);
    expect(out).toEqual([["fast"], [], []]);
  });
});

describe("emptyResultMessage", () => {
  it("tells the debater WHY nothing is shown, since each cause needs a different next step", () => {
    expect(emptyResultMessage(40, 0, true)).toMatch(/none of them argue this claim/);
    expect(emptyResultMessage(40, 0, false)).toMatch(/ranker was busy/);
    expect(emptyResultMessage(40, 7, false)).toMatch(/none had full text/);
  });
});

describe("emptyResultMessage — keyword picks", () => {
  it("doesn't call keyword picks 'relevant' when the AI never judged them", () => {
    const msg = emptyResultMessage(40, 6, false, false);
    expect(msg).not.toMatch(/relevant/);
    expect(msg).toMatch(/ranker was busy/);
  });
});

describe("keywordRanking — word forms", () => {
  it("matches a claim's verb in its other forms ('reduce' / 'reduces' / 'reducing')", () => {
    const pool = [
      candidate("Unrelated study of rainfall", { abstract: "Rainfall patterns." }),
      candidate("Cash grants reduce hunger", { abstract: "Grants reducing hunger in villages." }),
    ];
    const out = keywordRanking("Cash grants reduces hunger", pool);
    expect(out[0].article.title).toBe("Cash grants reduce hunger");
  });
});
