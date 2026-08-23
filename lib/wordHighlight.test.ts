import { describe, expect, it } from "vitest";
import { HIGHLIGHT_HEX } from "@/components/CardToolbar";
import { WORD_HIGHLIGHT_NAMES, wordHighlightName } from "@/lib/wordHighlight";

describe("wordHighlightName", () => {
  it("maps every colour the toolbar offers to an exact Word pen", () => {
    // If these ever stopped landing exactly, cards would export in a shade the
    // debater didn't pick — the reason the palette was chosen this way.
    expect(wordHighlightName(HIGHLIGHT_HEX.cyan)).toBe("cyan");
    expect(wordHighlightName(HIGHLIGHT_HEX.yellow)).toBe("yellow");
    expect(wordHighlightName(HIGHLIGHT_HEX.green)).toBe("green");
  });

  it("accepts the run format used on the card (uppercase, no hash)", () => {
    expect(wordHighlightName("00FFFF")).toBe("cyan");
    expect(wordHighlightName("FFFF00")).toBe("yellow");
  });

  it("snaps an off-palette colour from a pasted card to the nearest pen", () => {
    expect(wordHighlightName("#fffb00")).toBe("yellow");
    expect(wordHighlightName("#00e8f0")).toBe("cyan");
    expect(wordHighlightName("#12ff2a")).toBe("green");
    expect(wordHighlightName("#ff2b2b")).toBe("red");
  });

  it("keeps a white highlight white rather than inventing emphasis", () => {
    expect(wordHighlightName("#ffffff")).toBe("white");
  });

  it("returns undefined when there is no highlight", () => {
    expect(wordHighlightName(null)).toBeUndefined();
    expect(wordHighlightName(undefined)).toBeUndefined();
    expect(wordHighlightName("")).toBeUndefined();
  });

  it("returns undefined for anything that isn't a colour", () => {
    expect(wordHighlightName("transparent")).toBeUndefined();
    expect(wordHighlightName("#12")).toBeUndefined();
    expect(wordHighlightName("rgb(0,255,255)")).toBeUndefined();
  });

  it("only ever returns a name Word will accept", () => {
    for (const hex of ["#00ffff", "#123456", "#abcdef", "#800000", "#c0c0c0"]) {
      expect(WORD_HIGHLIGHT_NAMES).toContain(wordHighlightName(hex));
    }
  });
});
