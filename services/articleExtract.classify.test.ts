import { describe, expect, it } from "vitest";
import { classifyText, isMostlyAbstract, MIN_FULL_TEXT_CHARS } from "./articleExtract";

/**
 * "Full text" used to mean "the fetch worked and returned 2,200+ characters".
 * A publisher landing page that shows only the abstract — often followed by the
 * whole reference list — passes that bar, and a card cut from it is exactly the
 * thin, power-tagged card users reported. These cases pin down that full text is
 * judged by what came back.
 */

// Deterministic prose: `words` distinct-ish words, broken into sentences of 15.
function prose(words: number, seed: string): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    out.push(`${seed}${i % 97}`);
    if ((i + 1) % 15 === 0) out[out.length - 1] += ".";
  }
  const text = out.join(" ");
  return text.endsWith(".") ? text : `${text}.`;
}

const ABSTRACT = prose(220, "abs"); // ~1,500 chars — a typical abstract

const references = Array.from(
  { length: 30 },
  (_, i) =>
    `Author${i}, A., Coauthor${i}, B., et al. (20${10 + (i % 15)}). Title of cited study number ${i}. Journal of Things, ${i + 3}(2), ${100 + i}-${120 + i}. https://doi.org/10.1000/ref${i}`,
);

describe("classifyText", () => {
  it("treats anything under the full-text bar as abstract-only", () => {
    expect(classifyText("x ".repeat(MIN_FULL_TEXT_CHARS / 2 - 10))).toBe("abstract_only");
  });

  it("does not mistake an abstract plus its reference list for full text", () => {
    const landingPage = [ABSTRACT, "References", ...references].join("\n\n");
    expect(landingPage.length).toBeGreaterThan(MIN_FULL_TEXT_CHARS);
    expect(classifyText(landingPage)).toBe("abstract_only");
    expect(classifyText(landingPage, ABSTRACT)).toBe("abstract_only");
  });

  it("does not count the caller's own abstract as body text", () => {
    // A structured abstract split into sections, plus a little page furniture.
    const sections = [
      `Background: ${prose(120, "bg")}`,
      `Methods: ${prose(120, "me")}`,
      `Results: ${prose(130, "re")}`,
      `Conclusions: ${prose(110, "co")}`,
    ];
    const page = [...sections, "Download PDF", "Share this article", "Cite this"].join("\n\n");
    expect(page.length).toBeGreaterThan(MIN_FULL_TEXT_CHARS);
    expect(classifyText(page, sections.join(" "))).toBe("abstract_only");
  });

  it("recognizes a real article, even when it opens with its abstract", () => {
    const body = Array.from({ length: 10 }, (_, i) => prose(90, `p${i}w`));
    const article = [ABSTRACT, ...body].join("\n\n");
    expect(classifyText(article, ABSTRACT)).toBe("full_text");
    expect(classifyText(article)).toBe("full_text");
  });

  it("recognizes a news story written in short paragraphs", () => {
    const story = Array.from({ length: 14 }, (_, i) => prose(32, `n${i}w`)).join("\n\n");
    expect(classifyText(story)).toBe("full_text");
  });

  it("recognizes academic prose that cites heavily", () => {
    const cited = Array.from(
      { length: 8 },
      (_, i) =>
        `${prose(70, `c${i}w`)} This extends earlier findings (Smith et al., 2019; Jones, 2021, pp. 44-46).`,
    ).join("\n\n");
    expect(classifyText(cited)).toBe("full_text");
  });
});

describe("classifyText — line breaks and run-together pages", () => {
  // Hard-wrap prose at ~10 words per line, the way text pasted from a PDF arrives.
  const hardWrap = (text: string) => {
    const words = text.split(" ");
    const lines: string[] = [];
    for (let i = 0; i < words.length; i += 10) lines.push(words.slice(i, i + 10).join(" "));
    return lines.join("\n");
  };

  it("reflows a hard-wrapped pasted article instead of reading every line as a snippet", () => {
    const article = Array.from({ length: 8 }, (_, i) => hardWrap(prose(90, `h${i}w`))).join("\n");
    expect(classifyText(article)).toBe("full_text");
  });

  it("does not count an abstract plus its reference list run together as one block", () => {
    const oneBlock = [ABSTRACT, "References", ...references].join(" ");
    expect(oneBlock.length).toBeGreaterThan(MIN_FULL_TEXT_CHARS);
    expect(classifyText(oneBlock)).toBe("abstract_only");
  });
});

describe("isMostlyAbstract", () => {
  it("tells an abstract landing page from a short but complete page", () => {
    const landing = [ABSTRACT, "Cite this", ...references.slice(0, 5)].join("\n\n");
    expect(isMostlyAbstract(landing, ABSTRACT)).toBe(true);
    const brief = Array.from({ length: 5 }, (_, i) => prose(30, `b${i}w`)).join("\n\n");
    expect(isMostlyAbstract(brief, ABSTRACT)).toBe(false);
    expect(isMostlyAbstract(landing, undefined)).toBe(false);
  });
});
