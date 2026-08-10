import { describe, expect, it } from "vitest";
import {
  appendSourceUrl,
  fitRangeToBudget,
  resolveUnderlines,
  splitIntoSections,
  splitParagraphs,
  splitSentences,
} from "./cardCutter";

describe("splitParagraphs", () => {
  it("splits on newlines and drops empties", () => {
    expect(splitParagraphs("one\n\ntwo\n \nthree")).toEqual(["one", "two", "three"]);
  });
});

describe("splitIntoSections", () => {
  // A paragraph of N words, so word budgets are easy to reason about.
  const para = (n: number, label = "w") => Array(n).fill(label).join(" ");

  it("returns a single section when the passage fits one budget (unchanged path)", () => {
    const paras = [para(100), para(100), para(100)]; // 300 words < 900 budget
    const sections = splitIntoSections(paras, 900, 8);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toBe(paras.join("\n\n"));
  });

  it("splits a long passage into ~budget-sized sections on paragraph boundaries", () => {
    const paras = Array.from({ length: 12 }, () => para(300)); // 3,600 words
    const sections = splitIntoSections(paras, 900, 8);
    // ~900 words per section → 3 paragraphs each → 4 sections.
    expect(sections).toHaveLength(4);
    for (const s of sections) {
      expect(splitParagraphs(s)).toHaveLength(3);
    }
  });

  it("never exceeds the section cap (huge 'Entire Article' passage)", () => {
    const paras = Array.from({ length: 100 }, () => para(300)); // 30,000 words
    const sections = splitIntoSections(paras, 900, 8);
    expect(sections.length).toBeLessThanOrEqual(8);
  });

  it("preserves every paragraph in order (sections rejoin to the original passage)", () => {
    const paras = Array.from({ length: 20 }, (_, i) => para(200, `p${i}`));
    const sections = splitIntoSections(paras, 900, 8);
    expect(sections.join("\n\n")).toBe(paras.join("\n\n"));
    expect(sections.flatMap(splitParagraphs)).toEqual(paras);
  });

  it("handles an empty passage", () => {
    expect(splitIntoSections([], 900, 8)).toEqual([]);
  });
});

describe("appendSourceUrl", () => {
  const url = "https://example.com/article";

  it("appends the URL to the cite", () => {
    expect(appendSourceUrl('Jane Smith, "Title." Foreign Policy, 2026', url)).toBe(
      'Jane Smith, "Title." Foreign Policy, 2026, ' + url,
    );
  });

  it("uses a space (not a comma) when the cite already ends with punctuation", () => {
    expect(appendSourceUrl("Reuters, 2025.", url)).toBe("Reuters, 2025. " + url);
  });

  it("does not duplicate a URL already present in the cite", () => {
    const cite = `Reuters, 2025, ${url}`;
    expect(appendSourceUrl(cite, url)).toBe(cite);
  });

  it("is a no-op (trimmed) when there is no URL — e.g. pasted text", () => {
    expect(appendSourceUrl("  Reuters, 2025  ", undefined)).toBe("Reuters, 2025");
  });
});

describe("fitRangeToBudget", () => {
  // 10 paragraphs of 100 words each → each is 10% of the article.
  const counts = Array(10).fill(100);

  it("keeps a selection already inside the budget", () => {
    // Paragraphs 2..6 = 50% — inside Medium's 35-65%.
    expect(fitRangeToBudget(counts, 2, 6, { min: 0.35, max: 0.65 })).toEqual([2, 6]);
  });

  it("expands a too-small selection to reach the minimum (Medium = half)", () => {
    // One paragraph (10%) selected for Medium → must grow to ≥35%.
    const [s, e] = fitRangeToBudget(counts, 4, 4, { min: 0.35, max: 0.65 });
    const frac = (e - s + 1) / 10;
    expect(frac).toBeGreaterThanOrEqual(0.35);
    expect(frac).toBeLessThanOrEqual(0.65);
  });

  it("shrinks a too-large selection for Short", () => {
    // 8 paragraphs (80%) selected for Short → must shrink to ≤30%.
    const [s, e] = fitRangeToBudget(counts, 1, 8, { min: 0.05, max: 0.3 });
    expect((e - s + 1) / 10).toBeLessThanOrEqual(0.3);
    expect(s).toBe(1); // keeps the selected opening
  });

  it("expands toward the start when the end is exhausted", () => {
    const [s, e] = fitRangeToBudget(counts, 9, 9, { min: 0.35, max: 0.65 });
    expect(e).toBe(9);
    const frac = (e - s + 1) / 10;
    expect(frac).toBeGreaterThanOrEqual(0.35);
  });

  it("handles tiny articles without crashing", () => {
    expect(fitRangeToBudget([50], 0, 0, { min: 0.35, max: 0.65 })).toEqual([0, 0]);
    expect(fitRangeToBudget([], 0, 0, { min: 0.35, max: 0.65 })).toEqual([0, 0]);
  });

  it("clamps out-of-range indices", () => {
    const [s, e] = fitRangeToBudget(counts, 50, 99, { min: 0.05, max: 0.3 });
    expect(s).toBeLessThan(10);
    expect(e).toBeLessThan(10);
    expect(e).toBeGreaterThanOrEqual(s);
  });
});

/*
 * Sentences are the unit the marker now works in: it underlines by NUMBER
 * rather than copying text back, which is what took real long-article cards
 * from 3-6% underlined to 20-43%. A wrong split only moves where an underline
 * starts or stops, so the splitter is deliberately conservative — merging two
 * sentences is much cheaper than slicing "U.S. policy" in half.
 */
describe("splitSentences", () => {
  it("splits ordinary prose on terminal punctuation", () => {
    expect(splitSentences("One thing. Two things! Three things?")).toEqual([
      "One thing.",
      "Two things!",
      "Three things?",
    ]);
  });

  it("does not split on abbreviations or initials", () => {
    expect(splitSentences("U.S. policy shifted. Dr. Smith agreed.")).toEqual([
      "U.S. policy shifted.",
      "Dr. Smith agreed.",
    ]);
    expect(splitSentences("See Fig. 3 for the trend.")).toEqual(["See Fig. 3 for the trend."]);
    expect(splitSentences("Written by J. R. Hobbes in 1988.")).toEqual([
      "Written by J. R. Hobbes in 1988.",
    ]);
  });

  it("keeps a closing quote or bracket with its sentence", () => {
    expect(splitSentences('He said "it ends." Then he left.')).toEqual([
      'He said "it ends."',
      "Then he left.",
    ]);
  });

  // Paragraphs are split first, so a heading with no terminal punctuation can't
  // absorb the sentence after it — which would underline a heading and its
  // following claim as one indivisible unit.
  it("never merges across a paragraph break", () => {
    expect(splitSentences("Overview\n\nThe risk is real.")).toEqual([
      "Overview",
      "The risk is real.",
    ]);
  });

  it("drops empty fragments and trims", () => {
    expect(splitSentences("  A sentence.   \n\n  \n\n Another.  ")).toEqual([
      "A sentence.",
      "Another.",
    ]);
  });

  it("returns every sentence of the passage, in order", () => {
    const sentences = splitSentences("First. Second. Third.\n\nFourth.");
    expect(sentences).toHaveLength(4);
    expect(sentences[0]).toBe("First.");
    expect(sentences[3]).toBe("Fourth.");
  });
});

describe("resolveUnderlines", () => {
  const sentences = ["Zero.", "One.", "Two.", "Three."];

  it("maps indices to the real sentences, in the order given", () => {
    expect(resolveUnderlines(sentences, [0, 2])).toEqual(["Zero.", "Two."]);
  });

  /*
   * A hallucinated index is a guess about text that isn't there. Dropping it is
   * right; CLAMPING it would underline a real sentence the model never chose,
   * quietly attributing an emphasis decision to it that it never made.
   */
  it("drops out-of-range and non-integer indices rather than clamping", () => {
    expect(resolveUnderlines(sentences, [-1, 4, 99, 1.5, 2])).toEqual(["Two."]);
  });

  it("collapses duplicate indices", () => {
    expect(resolveUnderlines(sentences, [1, 1, 1])).toEqual(["One."]);
  });

  it("still honours legacy verbatim strings so an old-format reply isn't lost", () => {
    expect(resolveUnderlines(sentences, [0], ["Some copied text."])).toEqual([
      "Zero.",
      "Some copied text.",
    ]);
  });

  it("returns nothing when the model selected nothing", () => {
    expect(resolveUnderlines(sentences, [])).toEqual([]);
    expect(resolveUnderlines([], [0, 1])).toEqual([]);
  });
});
