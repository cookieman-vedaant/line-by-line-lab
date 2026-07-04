import { describe, expect, it } from "vitest";
import { normalizeForComparison, stripMarkup, verifyVerbatim } from "./verbatim";

const SOURCE = `Avidya is a Sanskrit word most commonly defined as ignorance. This can be misleading if we think of ignorance as a lack of knowledge. Avidya is not simply a lack of knowledge; it is a lack of what Hindu philosophers sometimes refer to as true knowledge.

The Advaita Vedanta school of Hinduism can be traced to the Upanisads, which are the last part of the Vedas.`;

describe("stripMarkup", () => {
  it("removes highlight and underline markers", () => {
    expect(stripMarkup("==Avidya is== a __Sanskrit word__")).toBe(
      "Avidya is a Sanskrit word",
    );
  });
});

describe("normalizeForComparison", () => {
  it("unifies curly quotes, dashes, and whitespace", () => {
    expect(normalizeForComparison("It’s  a “test” — really")).toBe(
      "it's a \"test\" - really",
    );
  });
});

describe("verifyVerbatim", () => {
  it("accepts a verbatim card with emphasis markers", () => {
    const body =
      "==Avidya is== a Sanskrit word most commonly defined as __ignorance__.";
    expect(verifyVerbatim(body, SOURCE).ok).toBe(true);
  });

  it("accepts omissions between verbatim chunks", () => {
    const body =
      "__Avidya is a Sanskrit word most commonly defined as ignorance.__ [...] __The Advaita Vedanta school of Hinduism can be traced to the Upanisads__";
    expect(verifyVerbatim(body, SOURCE).ok).toBe(true);
  });

  it("accepts typography differences (curly vs straight quotes)", () => {
    const source = "It’s the state’s duty — nothing less.";
    const body = "__It's the state's duty - nothing less.__";
    expect(verifyVerbatim(body, source).ok).toBe(true);
  });

  it("rejects paraphrased text", () => {
    const body = "__Avidya means being ignorant of spiritual truth.__";
    const verdict = verifyVerbatim(body, SOURCE);
    expect(verdict.ok).toBe(false);
    expect(verdict.failedChunk).toContain("avidya means");
  });

  it("rejects a card where one chunk is altered", () => {
    const body =
      "__Avidya is a Sanskrit word most commonly defined as ignorance.__ [...] __The Advaita Vedanta school was invented recently.__";
    expect(verifyVerbatim(body, SOURCE).ok).toBe(false);
  });

  it("rejects words changed inside an otherwise verbatim sentence", () => {
    const body = "__Avidya is a Latin word most commonly defined as ignorance.__";
    expect(verifyVerbatim(body, SOURCE).ok).toBe(false);
  });

  it("accepts whitespace/newline reflow", () => {
    const body = "__Avidya is a Sanskrit word\nmost commonly defined as ignorance.__";
    expect(verifyVerbatim(body, SOURCE).ok).toBe(true);
  });
});
