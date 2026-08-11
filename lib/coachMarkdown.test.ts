import { describe, expect, it } from "vitest";
import { parseCoachMarkdown, parseInline, type Block } from "@/lib/coachMarkdown";

/** Flatten a block's text, ignoring styling — handy for structural assertions. */
const textOf = (b: Block): string =>
  b.kind === "list"
    ? b.items.map((i) => i.map((s) => s.text).join("")).join(" | ")
    : b.spans.map((s) => s.text).join("");

describe("parseInline", () => {
  it("renders bold and italic rather than showing the markers", () => {
    expect(parseInline("The **Single Point of Failure** Advantage")).toEqual([
      { text: "The " },
      { text: "Single Point of Failure", bold: true },
      { text: " Advantage" },
    ]);
    expect(parseInline("colonialism is an *ideology*")).toEqual([
      { text: "colonialism is an " },
      { text: "ideology", italic: true },
    ]);
  });

  it("handles __bold__ as well as **bold**", () => {
    expect(parseInline("__warranted argument__")).toEqual([
      { text: "warranted argument", bold: true },
    ]);
  });

  /*
   * The failure this guards against: a stray marker styling the entire rest of
   * the message. A marker only counts when its closer is actually present, so an
   * unmatched one stays literal and the damage is two characters, not a
   * paragraph.
   */
  it("leaves an unmatched marker as literal text", () => {
    expect(parseInline("5 * 3 = 15")).toEqual([{ text: "5 * 3 = 15" }]);
    expect(parseInline("a **dangling marker")).toEqual([{ text: "a **dangling marker" }]);
  });

  it("leaves snake_case alone", () => {
    expect(parseInline("set the search_path value")).toEqual([
      { text: "set the search_path value" },
    ]);
  });

  it("treats markup inside code as literal", () => {
    expect(parseInline("use `a ** b` here")).toEqual([
      { text: "use " },
      { text: "a ** b", code: true },
      { text: " here" },
    ]);
  });

  it("returns nothing for an empty line", () => {
    expect(parseInline("")).toEqual([]);
  });
});

/*
 * The reply below is the shape the Coach really produces (numbered advantages,
 * bold labels, a follow-up question) — the output that was being shown to
 * debaters with its asterisks intact.
 */
describe("parseCoachMarkdown", () => {
  const reply = [
    "1. **The Single Point of Failure Advantage:** Instead of just resources, focus on Planetary Fragility.",
    "2. **The Technological Stagnation Advantage:** Instead of innovation, focus on Existential Stagnation.",
    "",
    "**Regarding your Set-Col response:**",
    'Saying "it doesn\'t apply to space" is a *defensive assertion*, not a warranted argument.',
    "",
    "To fix this, you need an **ontological defense**.",
  ].join("\n");

  it("turns numbered advice into a real list", () => {
    const blocks = parseCoachMarkdown(reply);
    const list = blocks.find((b) => b.kind === "list");
    expect(list).toBeDefined();
    if (list?.kind !== "list") throw new Error("expected a list");
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(2);
    expect(list.items[0][0]).toEqual({
      text: "The Single Point of Failure Advantage:",
      bold: true,
    });
  });

  it("keeps the prose after the list as separate paragraphs", () => {
    const blocks = parseCoachMarkdown(reply);
    const paras = blocks.filter((b) => b.kind === "paragraph");
    expect(paras.length).toBeGreaterThanOrEqual(2);
    expect(textOf(paras[paras.length - 1])).toBe("To fix this, you need an ontological defense.");
  });

  it("never leaves an asterisk in the rendered text", () => {
    for (const b of parseCoachMarkdown(reply)) {
      expect(textOf(b)).not.toContain("**");
    }
  });

  it("parses bullet lists and headings", () => {
    const blocks = parseCoachMarkdown("## Framing\n\n- first point\n- second point");
    expect(blocks[0]).toEqual({ kind: "heading", level: 2, spans: [{ text: "Framing" }] });
    if (blocks[1]?.kind !== "list") throw new Error("expected a list");
    expect(blocks[1].ordered).toBe(false);
    expect(blocks[1].items).toHaveLength(2);
  });

  it("does not merge a bullet list into a numbered one", () => {
    const blocks = parseCoachMarkdown("1. first\n- bullet");
    const lists = blocks.filter((b) => b.kind === "list");
    expect(lists).toHaveLength(2);
  });

  // A wrapped list item must stay in its own bullet rather than breaking out
  // into a paragraph halfway through the advice.
  it("keeps a continuation line inside its list item", () => {
    const blocks = parseCoachMarkdown("1. the first point\nwhich continues here");
    const lists = blocks.filter((b) => b.kind === "list");
    expect(lists).toHaveLength(1);
    expect(textOf(lists[0])).toBe("the first point which continues here");
  });

  it("handles plain prose with no markup at all", () => {
    const blocks = parseCoachMarkdown("Just a sentence.");
    expect(blocks).toEqual([{ kind: "paragraph", spans: [{ text: "Just a sentence." }] }]);
  });

  it("handles an empty reply", () => {
    expect(parseCoachMarkdown("")).toEqual([]);
    expect(parseCoachMarkdown("\n\n  \n")).toEqual([]);
  });
});
