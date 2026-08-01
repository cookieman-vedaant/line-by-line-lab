import { describe, expect, it } from "vitest";
import { deriveOpponentClaim, isVerbatimQuote, parseUrlFromCard } from "./rehighlighter";

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
