import { describe, expect, it } from "vitest";
import { extractJson } from "./json";

describe("extractJson", () => {
  it("parses a message that is pure JSON", () => {
    expect(extractJson('{"articles": []}')).toEqual({ articles: [] });
  });

  it("parses JSON surrounded by whitespace", () => {
    expect(extractJson('  \n {"a": 1} \n ')).toEqual({ a: 1 });
  });

  it("parses a fenced ```json block", () => {
    const text = 'Here are the results:\n```json\n{"articles": [{"title": "T"}]}\n```';
    expect(extractJson(text)).toEqual({ articles: [{ title: "T" }] });
  });

  it("parses a fenced block without a language tag", () => {
    expect(extractJson('```\n{"ok": true}\n```')).toEqual({ ok: true });
  });

  it("parses JSON embedded in prose", () => {
    const text = 'I found these. {"articles": []} Let me know if you need more.';
    expect(extractJson(text)).toEqual({ articles: [] });
  });

  it("handles nested braces inside embedded JSON", () => {
    const text = 'Result: {"card": {"tag": "AI destroys jobs", "body": "text {with} braces"}}';
    expect(extractJson(text)).toEqual({
      card: { tag: "AI destroys jobs", body: "text {with} braces" },
    });
  });

  it("returns null for text with no JSON", () => {
    expect(extractJson("Sorry, I could not find anything.")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(extractJson('{"articles": [unclosed')).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractJson("")).toBeNull();
  });
});
