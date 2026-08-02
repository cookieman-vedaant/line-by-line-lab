import { describe, expect, it } from "vitest";
import {
  appendSourceUrl,
  fitRangeToBudget,
  splitIntoSections,
  splitParagraphs,
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
