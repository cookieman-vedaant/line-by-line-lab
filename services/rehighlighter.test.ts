import { describe, expect, it } from "vitest";
import { stripDelimiters } from "@/lib/cardMarkup";
import type { ExtractedArticle } from "@/services/articleExtract";
import {
  buildRehighlightResult,
  deriveOpponentClaim,
  isVerbatimQuote,
  parseUrlFromCard,
  type RehighlightAnalysis,
} from "./rehighlighter";

describe("parseUrlFromCard", () => {
  it("pulls the first http(s) URL from a pasted card", () => {
    const card = 'Tag here\nSmith 24 [Jane Smith, "Title." FP, 2024, https://fp.com/a]\nBody…';
    expect(parseUrlFromCard(card)).toBe("https://fp.com/a");
  });
  it("strips trailing punctuation from the URL", () => {
    expect(parseUrlFromCard("see https://example.com/x.")).toBe("https://example.com/x");
  });
  it("returns undefined when there is no URL", () => {
    expect(parseUrlFromCard("Smith 24 [Jane Smith, FP, 2024]")).toBeUndefined();
  });
});

describe("deriveOpponentClaim", () => {
  it("prefers an explicit claim", () => {
    expect(deriveOpponentClaim({}, "  Sanctions work  ")).toBe("Sanctions work");
  });
  it("falls back to the first non-empty line of a pasted card (the tag)", () => {
    expect(deriveOpponentClaim({ card: "\n  Sanctions cripple the regime\nSmith 24 […]\nBody" })).toBe(
      "Sanctions cripple the regime",
    );
  });
  it("returns '' when nothing is available", () => {
    expect(deriveOpponentClaim({})).toBe("");
  });
});

describe("isVerbatimQuote", () => {
  const source = "The sanctions had, at best, a modest and short-lived effect on the economy.";
  it("matches ignoring quote/dash/whitespace typography", () => {
    expect(isVerbatimQuote("a modest and short-lived effect", source)).toBe(true);
    expect(isVerbatimQuote("a modest and short—lived  effect", source)).toBe(true);
  });
  it("rejects wording that isn't in the source", () => {
    expect(isVerbatimQuote("a huge and permanent effect", source)).toBe(false);
  });
  it("rejects quotes that are too short to be meaningful", () => {
    expect(isVerbatimQuote("the", source)).toBe(false);
  });
});

const article: ExtractedArticle = {
  title: "Do Sanctions Work?",
  author: "Jane Smith",
  publication: "Foreign Policy",
  date: "2024-01-01",
  text:
    "Sanctions are often praised as decisive. In practice, however, the regime rerouted trade through neighbors. The effect on the economy was, at best, modest and short-lived.",
  authors: ["Jane Smith"],
  authorQualification: "",
  publisherQualification: "",
  canonicalUrl: "",
};

const analysis: RehighlightAnalysis = {
  tag: "Their own source says the effect was __modest and short-lived__.",
  cite: "Smith 24",
  citeDetails: 'Jane Smith, "Do Sanctions Work?" Foreign Policy, 2024',
  underlines: ["The effect on the economy was, at best, modest and short-lived."],
  highlights: ["modest and short-lived"],
  contradictions: [
    {
      quote: "the regime rerouted trade through neighbors",
      kind: "contradiction",
      explanation: "The article says evasion blunted the sanctions.",
      howToUse: "Read in the 1AR to show their author concedes evasion.",
    },
    {
      quote: "sanctions instantly toppled the government", // NOT in the article
      kind: "contradiction",
      explanation: "fabricated — must be dropped",
      howToUse: "n/a",
    },
  ],
};

describe("buildRehighlightResult", () => {
  it("drops contradictions whose quote is not verbatim in the article", () => {
    const r = buildRehighlightResult(article, analysis, "https://fp.com/a");
    expect(r.contradictions).toHaveLength(1);
    expect(r.contradictions[0].quote).toBe("the regime rerouted trade through neighbors");
  });

  it("applies emphasis to the real article text (verbatim body)", () => {
    const r = buildRehighlightResult(article, analysis);
    // The body is the real article text once delimiters are stripped.
    expect(stripDelimiters(r.card.body)).toContain("modest and short-lived");
    // Emphasis markers were actually inserted (body differs from plain text).
    expect(r.card.body).not.toBe(article.text);
  });

  it("appends the real source URL to the cite; converts tag markup", () => {
    const r = buildRehighlightResult(article, analysis, "https://fp.com/a");
    expect(r.card.citeDetails).toContain("https://fp.com/a");
    expect(r.card.tag).not.toContain("__"); // markup converted to delimiters
    expect(r.card.cite).toBe("Smith 24");
    expect(r.sourceUrl).toBe("https://fp.com/a");
    expect(r.articleTitle).toBe("Do Sanctions Work?");
  });

  it("is honest when nothing contradicts: empty contradictions + carries a notice", () => {
    const empty: RehighlightAnalysis = {
      tag: "No contradiction found.",
      cite: "Smith 24",
      citeDetails: "Jane Smith, Foreign Policy, 2024",
      underlines: [],
      highlights: [],
      contradictions: [],
    };
    const r = buildRehighlightResult(article, empty, undefined, "note");
    expect(r.contradictions).toHaveLength(0);
    expect(r.notice).toBe("note");
  });
});
