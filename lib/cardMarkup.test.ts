import { describe, expect, it } from "vitest";
import {
  BOLD_CLOSE,
  BOLD_OPEN,
  HIGHLIGHT_CLOSE,
  HIGHLIGHT_OPEN,
  parseCardMarkup,
  stripDelimiters,
  tagMarkupToDelimiters,
  UNDERLINE_CLOSE,
  UNDERLINE_OPEN,
} from "./cardMarkup";

// Readable helpers for building delimiter strings in tests.
const u = (s: string) => `${UNDERLINE_OPEN}${s}${UNDERLINE_CLOSE}`;
const h = (s: string) => `${HIGHLIGHT_OPEN}${s}${HIGHLIGHT_CLOSE}`;

describe("parseCardMarkup", () => {
  it("parses flat plain/underline/highlight sequences", () => {
    expect(parseCardMarkup(`a ${u("b")} ${h("c")} d`)).toEqual([
      { kind: "plain", bold: false, text: "a " },
      { kind: "underline", bold: false, text: "b" },
      { kind: "plain", bold: false, text: " " },
      { kind: "highlight", bold: false, text: "c" },
      { kind: "plain", bold: false, text: " d" },
    ]);
  });

  it("handles highlights nested inside underlines", () => {
    const input = `${UNDERLINE_OPEN}read ${h("KEY")} aloud${UNDERLINE_CLOSE}`;
    expect(parseCardMarkup(input)).toEqual([
      { kind: "underline", bold: false, text: "read " },
      { kind: "highlight", bold: false, text: "KEY" },
      { kind: "underline", bold: false, text: " aloud" },
    ]);
  });

  it("returns a single plain node for unmarked text", () => {
    expect(parseCardMarkup("just text")).toEqual([{ kind: "plain", bold: false, text: "just text" }]);
  });

  // The whole point of the private-use delimiters: literal ==/__ in the
  // article must render as ordinary text, never as emphasis markers.
  it("passes literal == and __ through as plain text", () => {
    expect(parseCardMarkup("code x == y and file_name__here")).toEqual([
      { kind: "plain", bold: false, text: "code x == y and file_name__here" },
    ]);
  });

  it("keeps literal markers plain even next to real emphasis", () => {
    const input = `see ${u("the value")} where a == b`;
    expect(parseCardMarkup(input)).toEqual([
      { kind: "plain", bold: false, text: "see " },
      { kind: "underline", bold: false, text: "the value" },
      { kind: "plain", bold: false, text: " where a == b" },
    ]);
  });
});

describe("stripDelimiters", () => {
  it("removes every internal delimiter", () => {
    const input = `${h("a")} b ${u("c")}`;
    expect(stripDelimiters(input)).toBe("a b c");
  });

  it("leaves literal ==/__ untouched", () => {
    expect(stripDelimiters("a == b __ c")).toBe("a == b __ c");
  });
});

describe("tagMarkupToDelimiters", () => {
  it("converts AI __phrase__ markup to underline delimiters", () => {
    expect(tagMarkupToDelimiters("The US economy is __robust__ and __growing__")).toBe(
      `The US economy is ${u("robust")} and ${u("growing")}`,
    );
  });

  it("strips a stray unbalanced marker instead of showing it", () => {
    expect(tagMarkupToDelimiters("half __open marker")).toBe("half open marker");
  });

  it("strips any pre-existing delimiters from the AI input", () => {
    expect(tagMarkupToDelimiters(`sneaky ${HIGHLIGHT_OPEN}injection`)).toBe("sneaky injection");
  });
});

/**
 * Bold is a separate axis from kind, and the card format constrains where it
 * may appear: only over text that is already underlined. These tests pin the
 * four legal states and the one illegal one.
 */
const bold = (t: string) => `${BOLD_OPEN}${t}${BOLD_CLOSE}`;

describe("parseCardMarkup — bold", () => {
  it("marks underlined text bold when wrapped in bold delimiters", () => {
    expect(parseCardMarkup(u(bold("critical")))).toEqual([
      { kind: "underline", bold: true, text: "critical" },
    ]);
  });

  it("bolds only part of an underlined run", () => {
    expect(parseCardMarkup(UNDERLINE_OPEN + "read " + bold("KEY") + " aloud" + UNDERLINE_CLOSE)).toEqual([
      { kind: "underline", bold: false, text: "read " },
      { kind: "underline", bold: true, text: "KEY" },
      { kind: "underline", bold: false, text: " aloud" },
    ]);
  });

  it("supports underline + highlight + bold together", () => {
    expect(parseCardMarkup(u(h(bold("warrant"))))).toEqual([
      { kind: "highlight", bold: true, text: "warrant" },
    ]);
  });

  it("NEVER bolds un-underlined text — the format has no bold-only state", () => {
    // A stray bold span over plain context must be dropped, not rendered.
    expect(parseCardMarkup(bold("plain context"))).toEqual([
      { kind: "plain", bold: false, text: "plain context" },
    ]);
  });

  it("drops bold when it spills outside the underline", () => {
    // Bold opens inside the underline but closes after it; the trailing plain
    // text must come back unbolded.
    const input = UNDERLINE_OPEN + "inside " + BOLD_OPEN + "still" + UNDERLINE_CLOSE + " outside" + BOLD_CLOSE;
    expect(parseCardMarkup(input)).toEqual([
      { kind: "underline", bold: false, text: "inside " },
      { kind: "underline", bold: true, text: "still" },
      { kind: "plain", bold: false, text: " outside" },
    ]);
  });

  it("merges adjacent runs only when kind AND bold both match", () => {
    expect(parseCardMarkup(u("a") + u("b"))).toEqual([
      { kind: "underline", bold: false, text: "ab" },
    ]);
    expect(parseCardMarkup(u("a") + u(bold("c")))).toEqual([
      { kind: "underline", bold: false, text: "a" },
      { kind: "underline", bold: true, text: "c" },
    ]);
  });

  it("strips bold delimiters from user-visible text", () => {
    expect(stripDelimiters(u(bold("x")))).toBe("x");
  });
});
