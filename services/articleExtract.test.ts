import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  cleanAuthor,
  extractPageMetadata,
  findBylineInText,
  normalizeDate,
} from "./articleExtract";

const docFrom = (head: string): Document =>
  new JSDOM(`<!doctype html><html><head>${head}</head><body></body></html>`).window.document;

describe("extractPageMetadata", () => {
  it("reads author/date/publication from meta tags", () => {
    const doc = docFrom(`
      <meta name="author" content="Jane Smith">
      <meta property="og:site_name" content="Foreign Policy Review">
      <meta property="article:published_time" content="2026-03-12T09:00:00Z">
    `);
    const meta = extractPageMetadata(doc);
    expect(meta.author).toBe("Jane Smith");
    expect(meta.publication).toBe("Foreign Policy Review");
    expect(meta.date).toBe("2026-03-12");
  });

  it("falls back to JSON-LD for the author and date", () => {
    const doc = docFrom(`
      <script type="application/ld+json">
        {"@type":"NewsArticle","author":{"@type":"Person","name":"Dr. Alan Ng"},
         "datePublished":"2025-11-02","publisher":{"name":"The Economist"}}
      </script>
    `);
    const meta = extractPageMetadata(doc);
    expect(meta.author).toBe("Dr. Alan Ng");
    expect(meta.date).toBe("2025-11-02");
    expect(meta.publication).toBe("The Economist");
  });

  it("handles JSON-LD with a @graph and multiple authors", () => {
    const doc = docFrom(`
      <script type="application/ld+json">
        {"@graph":[{"@type":"Article","author":[{"name":"A. One"},{"name":"B. Two"}]}]}
      </script>
    `);
    expect(extractPageMetadata(doc).author).toBe("A. One, B. Two");
  });

  it("skips a JSON-LD author typed as an Organization (the site as 'author')", () => {
    const doc = docFrom(`
      <script type="application/ld+json">
        {"@type":"NewsArticle","author":{"@type":"Organization","name":"Reuters"},
         "publisher":{"name":"Reuters"}}
      </script>
    `);
    // No human byline → author stays empty (cite then falls back to publication).
    expect(extractPageMetadata(doc).author).toBe("");
  });

  it("keeps the human author when both a person and an org are listed", () => {
    const doc = docFrom(`
      <script type="application/ld+json">
        {"@type":"NewsArticle","author":[{"@type":"Person","name":"Jane Smith"},
         {"@type":"Organization","name":"CNN"}]}
      </script>
    `);
    expect(extractPageMetadata(doc).author).toBe("Jane Smith");
  });

  it("prefers meta author over JSON-LD, and never throws on malformed JSON-LD", () => {
    const doc = docFrom(`
      <meta name="author" content="Primary Author">
      <script type="application/ld+json">{ this is not valid json </script>
    `);
    expect(extractPageMetadata(doc).author).toBe("Primary Author");
  });

  it("returns empty fields when nothing is present", () => {
    const meta = extractPageMetadata(docFrom(""));
    expect(meta).toEqual({ title: "", author: "", publication: "", date: "" });
  });
});

describe("cleanAuthor", () => {
  it("keeps a real human author", () => {
    expect(cleanAuthor("Jane Smith", "Reuters")).toBe("Jane Smith");
  });
  it("blanks an author that equals the publication", () => {
    expect(cleanAuthor("Reuters", "Reuters")).toBe("");
    expect(cleanAuthor("bbc news", "BBC News")).toBe("");
  });
  it("blanks an author that contains the publication name", () => {
    expect(cleanAuthor("BBC News Staff", "BBC News")).toBe("");
  });
  it("does not over-match a short/empty publication", () => {
    expect(cleanAuthor("Ed Wong", "")).toBe("Ed Wong");
    expect(cleanAuthor("Al Gore", "AP")).toBe("Al Gore"); // pub too short to match loosely
  });
});

describe("normalizeDate", () => {
  it("extracts an ISO date from a timestamp", () => {
    expect(normalizeDate("2026-03-12T09:00:00Z")).toBe("2026-03-12");
  });
  it("parses a human date", () => {
    expect(normalizeDate("April 26, 2016")).toBe("2016-04-26");
  });
  it("returns empty for junk", () => {
    expect(normalizeDate("sometime last year")).toBe("");
    expect(normalizeDate("")).toBe("");
  });
});

describe("findBylineInText", () => {
  it("finds an 'Article written by:' byline", () => {
    expect(findBylineInText("Some intro. Article written by: Robin Wilcox. More text.")).toBe(
      "Robin Wilcox",
    );
  });
  it("finds a leading 'By NAME' byline", () => {
    expect(findBylineInText("By Jane Q. Smith\nThe article begins here.")).toBe("Jane Q. Smith");
  });
  it("returns empty when there's no byline", () => {
    expect(findBylineInText("This article has no byline anywhere in it.")).toBe("");
  });
});
