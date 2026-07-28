import { describe, expect, it } from "vitest";
import {
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
      { kind: "plain", text: "a " },
      { kind: "underline", text: "b" },
      { kind: "plain", text: " " },
      { kind: "highlight", text: "c" },
      { kind: "plain", text: " d" },
    ]);
  });

  it("handles highlights nested inside underlines", () => {
    const input = `${UNDERLINE_OPEN}read ${h("KEY")} aloud${UNDERLINE_CLOSE}`;
    expect(parseCardMarkup(input)).toEqual([
      { kind: "underline", text: "read " },
      { kind: "highlight", text: "KEY" },
      { kind: "underline", text: " aloud" },
    ]);
  });

  it("returns a single plain node for unmarked text", () => {
    expect(parseCardMarkup("just text")).toEqual([{ kind: "plain", text: "just text" }]);
  });

  // The whole point of the private-use delimiters: literal ==/__ in the
  // article must render as ordinary text, never as emphasis markers.
  it("passes literal == and __ through as plain text", () => {
    expect(parseCardMarkup("code x == y and file_name__here")).toEqual([
      { kind: "plain", text: "code x == y and file_name__here" },
    ]);
  });

  it("keeps literal markers plain even next to real emphasis", () => {
    const input = `see ${u("the value")} where a == b`;
    expect(parseCardMarkup(input)).toEqual([
      { kind: "plain", text: "see " },
      { kind: "underline", text: "the value" },
      { kind: "plain", text: " where a == b" },
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
