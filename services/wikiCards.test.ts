import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { describe, expect, it } from "vitest";
import { parseCardMarkup } from "@/lib/cardMarkup";
import { readDocx } from "@/lib/docx";
import { extractCards, rankCardsForQuery } from "@/services/wikiCards";

/**
 * End-to-end through a REAL .docx.
 *
 * The fixture is built with the same `docx` package the app uses for export, so
 * these tests run against genuine OOXML — zip, namespaces, run properties and
 * all — rather than a hand-written string that happens to match the parser. If
 * Word's actual shape and our reader ever disagree, this fails.
 */

/** A card as a debater actually formats one: tag heading, cite, emphasized body. */
function buildDebateDoc() {
  return new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "1AC — Dharma", heading: HeadingLevel.HEADING_2 }),

          new Paragraph({
            children: [
              new TextRun({ text: "Singal 19", bold: true }),
              new TextRun({ text: " [Vijay Singal, The Pioneer, December 9 2019]" }),
            ],
          }),

          new Paragraph({
            children: [
              new TextRun({ text: "Context nobody reads aloud. " }),
              new TextRun({ text: "Brahman is said to be the ", underline: {} }),
              new TextRun({ text: "Ultimate Reality", underline: {}, highlight: "yellow" }),
              new TextRun({ text: " of all things.", underline: {} }),
              new TextRun({ text: " More trailing context." }),
            ],
          }),

          // A second card under its own tag.
          new Paragraph({ text: "Dharma outweighs", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({
            children: [
              new TextRun({ text: "Patel 21", bold: true }),
              new TextRun({ text: " [Anita Patel, Journal of Ethics, 2021]" }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Duty ", underline: {} }),
              new TextRun({ text: "precedes consequence", underline: {}, bold: true }),
              new TextRun({ text: " in every case.", underline: {} }),
            ],
          }),

          // Pure analytics: a tag with NO emphasis anywhere. Not a card.
          new Paragraph({ text: "Roadmap", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: "Two off then case. Nothing here is evidence." }),
        ],
      },
    ],
  });
}

async function fixtureParagraphs() {
  const buffer = await Packer.toBuffer(buildDebateDoc());
  return readDocx(new Uint8Array(buffer));
}

describe("readDocx", () => {
  it("reads runs with their real formatting out of genuine OOXML", async () => {
    const paragraphs = await fixtureParagraphs();
    const body = paragraphs.find((p) => p.text.includes("Ultimate Reality"));
    expect(body).toBeDefined();

    const highlighted = body!.runs.find((r) => r.highlighted);
    expect(highlighted?.text).toBe("Ultimate Reality");
    // Highlighted text is also underlined here — the two are independent axes.
    expect(highlighted?.underline).toBe(true);

    // Un-emphasized context must NOT come back as emphasized, or every card
    // would render as entirely read-aloud.
    const plain = body!.runs.find((r) => r.text.includes("Context nobody reads"));
    expect(plain?.underline).toBe(false);
    expect(plain?.highlighted).toBe(false);
  });

  it("keeps the heading style, which is how tags are found", async () => {
    const paragraphs = await fixtureParagraphs();
    const tag = paragraphs.find((p) => p.text === "1AC — Dharma");
    expect(tag?.style).toMatch(/^Heading/i);
  });

  it("rejects anything that isn't a Word document", async () => {
    await expect(readDocx(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});

describe("extractCards", () => {
  it("pulls each cut card out with its tag, cite and emphasis", async () => {
    const { cards } = extractCards(await fixtureParagraphs());

    expect(cards).toHaveLength(2);
    expect(cards[0].tag).toBe("1AC — Dharma");
    expect(cards[0].cite).toBe("Singal 19");
    expect(cards[0].citeDetails).toContain("Vijay Singal");

    // The cite line must not also appear in the body.
    expect(cards[0].body).not.toContain("Vijay Singal");
  });

  it("maps the debater's formatting onto our own three layers", async () => {
    const { cards } = extractCards(await fixtureParagraphs());
    const nodes = parseCardMarkup(cards[0].body);

    const highlight = nodes.find((n) => n.kind === "highlight");
    expect(highlight?.text).toBe("Ultimate Reality");

    const underlined = nodes.filter((n) => n.kind === "underline").map((n) => n.text).join("");
    expect(underlined).toContain("Brahman is said to be the");

    // Context the debater didn't mark stays plain — it renders small and grey,
    // exactly as in the original file.
    const plain = nodes.filter((n) => n.kind === "plain").map((n) => n.text).join("");
    expect(plain).toContain("Context nobody reads aloud.");
  });

  it("carries bold across as a separate axis on emphasized text", async () => {
    const { cards } = extractCards(await fixtureParagraphs());
    const nodes = parseCardMarkup(cards[1].body);
    const bolded = nodes.filter((n) => n.bold);
    expect(bolded.map((n) => n.text).join("")).toBe("precedes consequence");
    // The invariant from cardMarkup: bold never appears on un-emphasized text.
    expect(bolded.every((n) => n.kind !== "plain")).toBe(true);
  });

  it("skips analytics — a block with no emphasis is not evidence", async () => {
    const { cards } = extractCards(await fixtureParagraphs());
    expect(cards.some((c) => c.tag === "Roadmap")).toBe(false);
  });

  it("never invents text: every word comes from the document", async () => {
    const paragraphs = await fixtureParagraphs();
    const source = paragraphs.map((p) => p.text).join(" ");
    const { cards } = extractCards(paragraphs);
    for (const card of cards) {
      for (const word of card.body.replace(/[\u{E000}-\u{E005}]/gu, "").split(/\s+/)) {
        if (word.trim()) expect(source).toContain(word);
      }
    }
  });
});

describe("rankCardsForQuery", () => {
  it("puts cards whose tag matches the query first", async () => {
    const { cards } = extractCards(await fixtureParagraphs());
    const ranked = rankCardsForQuery(cards, "outweighs");
    expect(ranked[0].tag).toBe("Dharma outweighs");
  });

  it("returns every card rather than nothing when the query matches no tag", async () => {
    // Solr matched the FILE on text we can't see, so an empty list here would
    // be a lie about the file's contents.
    const { cards } = extractCards(await fixtureParagraphs());
    expect(rankCardsForQuery(cards, "zzzz nonexistent").length).toBe(cards.length);
  });
});
