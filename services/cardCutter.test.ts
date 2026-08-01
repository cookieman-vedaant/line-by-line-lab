import { describe, expect, it } from "vitest";
import { appendSourceUrl, fitRangeToBudget, splitParagraphs } from "./cardCutter";

describe("splitParagraphs", () => {
  it("splits on newlines and drops empties", () => {
    expect(splitParagraphs("one\n\ntwo\n \nthree")).toEqual(["one", "two", "three"]);
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
