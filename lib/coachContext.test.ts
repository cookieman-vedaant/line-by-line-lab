import { describe, expect, it } from "vitest";
import { articlesToContext, cardToContext } from "@/lib/coachContext";
import type { Article, Card } from "@/types";

const article = (over: Partial<Article>): Article => ({
  title: "T",
  author: "A. Author",
  url: "https://example.com/x",
  publication: "Journal",
  date: "2025-01-01",
  explanation: "",
  credibilityScore: 80,
  ...over,
});

describe("articlesToContext", () => {
  it("numbers each article and includes the URL", () => {
    const out = articlesToContext([
      article({ title: "First", url: "https://a.com/1" }),
      article({ title: "Second", url: "https://b.com/2", accessible: true }),
    ]);
    expect(out).toContain('1. "First"');
    expect(out).toContain("https://a.com/1");
    expect(out).toContain('2. "Second"');
    expect(out).toContain("[full text confirmed]"); // only the accessible one
  });

  it("fills sensible placeholders for missing metadata", () => {
    const out = articlesToContext([article({ author: "", publication: "", date: "" })]);
    expect(out).toContain("unknown author");
    expect(out).toContain("unknown publication");
    expect(out).toContain("n.d.");
  });
});

describe("cardToContext", () => {
  const card: Card = {
    tag: "Space Race is underway",
    cite: "Hanlon 24",
    citeDetails: "Michelle Hanlon, SpaceNews, 2024",
    body: "The stakes are high. ".repeat(200),
  };

  it("includes the tag, cite, source, and a body excerpt", () => {
    const out = cardToContext(card, "SpaceNews article (https://x.com)");
    expect(out).toContain("Tag: Space Race is underway");
    expect(out).toContain("Cite: Hanlon 24 [Michelle Hanlon, SpaceNews, 2024]");
    expect(out).toContain("From: SpaceNews article");
    expect(out).toContain("Body (verbatim excerpt):");
  });

  it("truncates a long body with an ellipsis", () => {
    const out = cardToContext(card, "src", 100);
    expect(out).toContain("…");
    // The excerpt line is bounded by the previewChars cap (plus the label).
    const bodyLine = out.split("\n").find((l) => l.startsWith("Body")) ?? "";
    expect(bodyLine.length).toBeLessThan(160);
  });
});
