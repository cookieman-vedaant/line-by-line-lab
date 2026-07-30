import { describe, expect, it } from "vitest";
import { tavilyResultToCandidate } from "./webSearch";

describe("tavilyResultToCandidate", () => {
  it("maps a Tavily result to a CandidateArticle", () => {
    const c = tavilyResultToCandidate({
      title: "Nuclear power reduces emissions",
      url: "https://www.brookings.edu/articles/nuclear",
      content: "A study finds nuclear displaces coal.",
      published_date: "2026-01-15",
    });
    expect(c).not.toBeNull();
    expect(c?.title).toBe("Nuclear power reduces emissions");
    expect(c?.abstract).toBe("A study finds nuclear displaces coal.");
    expect(c?.venue).toBe("brookings.edu");
    expect(c?.date).toBe("2026-01-15");
    expect(c?.source).toBe("web");
    expect(c?.authors).toEqual([]);
  });

  it("derives the venue hostname and tolerates a missing date", () => {
    const c = tavilyResultToCandidate({
      title: "T",
      url: "https://example.org/x",
      content: "snippet",
    });
    expect(c?.venue).toBe("example.org");
    expect(c?.date).toBe("");
  });

  it("returns null when title or url is missing", () => {
    expect(tavilyResultToCandidate({ url: "https://x.com" })).toBeNull();
    expect(tavilyResultToCandidate({ title: "No url" })).toBeNull();
  });
});
