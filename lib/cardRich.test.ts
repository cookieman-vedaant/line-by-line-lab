import { describe, expect, it } from "vitest";
import {
  BOLD_CLOSE,
  BOLD_OPEN,
  HIGHLIGHT_CLOSE,
  HIGHLIGHT_OPEN,
  UNDERLINE_CLOSE,
  UNDERLINE_OPEN,
} from "./cardMarkup";
import { bodyParagraphHtml, CONTEXT_PT, READ_PT } from "./cardRich";

const CYAN = "#00FFFF";
const u = (s: string) => `${UNDERLINE_OPEN}${s}${UNDERLINE_CLOSE}`;
const h = (s: string) => `${HIGHLIGHT_OPEN}${s}${HIGHLIGHT_CLOSE}`;
const b = (s: string) => `${BOLD_OPEN}${s}${BOLD_CLOSE}`;

/** The <span> whose text is exactly `text`. */
function spanFor(html: string, text: string): string {
  const m = html.match(new RegExp(`<span style="([^"]*)">${text}</span>`));
  if (!m) throw new Error(`no span rendering "${text}" in:\n${html}`);
  return m[1];
}

const isBold = (css: string) => css.includes("font-weight:700");

describe("bodyParagraphHtml", () => {
  /*
   * The card format has four legal emphasis states, and each one must be
   * visually distinct. Bold is an independent axis, so weight must track `bold`
   * and NOTHING else — an earlier version hardcoded every highlight to 700,
   * which collapsed "highlighted" and "highlighted + bold" into identical
   * output and made the bold layer invisible wherever the marker used it.
   */
  it("renders the four legal states distinctly", () => {
    const html = bodyParagraphHtml(
      `ctx ${u("plainU")} ${u(b("boldU"))} ${h("plainH")} ${h(b("boldH"))}`,
      CYAN,
    );

    const plainU = spanFor(html, "plainU");
    const boldU = spanFor(html, "boldU");
    const plainH = spanFor(html, "plainH");
    const boldH = spanFor(html, "boldH");

    // All four are read-aloud size and underlined.
    for (const css of [plainU, boldU, plainH, boldH]) {
      expect(css).toContain(`font-size:${READ_PT}pt`);
      expect(css).toContain("text-decoration:underline");
    }

    // Weight tracks bold, and only bold.
    expect(isBold(plainU)).toBe(false);
    expect(isBold(boldU)).toBe(true);
    expect(isBold(plainH)).toBe(false);
    expect(isBold(boldH)).toBe(true);

    // Cyan tracks highlight, and only highlight.
    expect(plainU).not.toContain(CYAN);
    expect(boldU).not.toContain(CYAN);
    expect(plainH).toContain(`background-color:${CYAN}`);
    expect(boldH).toContain(`background-color:${CYAN}`);

    // The four states are pairwise different CSS.
    expect(new Set([plainU, boldU, plainH, boldH]).size).toBe(4);
  });

  it("renders un-emphasized text as small grey context, never bold", () => {
    const css = spanFor(bodyParagraphHtml("ctx", CYAN), "ctx");
    expect(css).toContain(`font-size:${CONTEXT_PT}pt`);
    expect(isBold(css)).toBe(false);
    expect(css).not.toContain("text-decoration:underline");
  });

  it("never bolds text that is not underlined", () => {
    // A stray bold span over plain text: the parser drops it, so the rendered
    // context text must still be plain 8pt grey.
    const css = spanFor(bodyParagraphHtml(b("stray"), CYAN), "stray");
    expect(isBold(css)).toBe(false);
    expect(css).toContain(`font-size:${CONTEXT_PT}pt`);
  });

  it("escapes HTML in the source text", () => {
    expect(bodyParagraphHtml(u("a <b> & c"), CYAN)).toContain("a &lt;b&gt; &amp; c");
  });
});
