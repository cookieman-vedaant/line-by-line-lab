/**
 * Map a highlight colour to Word's HIGHLIGHTER PEN.
 *
 * This distinction is the whole point of the file. Word has two different ways
 * to put colour behind text and they behave differently in the views debaters
 * actually read in:
 *
 *   w:shd  (shading)   — a fill painted behind the run. Read Mode and Dark Mode
 *                        recolour the TEXT for the page background but leave the
 *                        fill alone, so a cyan-shaded card turns into dark text
 *                        on a dark fill and becomes unreadable.
 *   w:highlight (pen)  — the highlighter. Word knows it is emphasis, keeps it
 *                        legible in Read Mode and Dark Mode, and it is what the
 *                        rest of the debate world means by "highlighted".
 *
 * So cards export with the pen, never with shading. The pen only accepts
 * seventeen named values, which sounds like a limitation and isn't: the app's
 * three highlight colours are #00ffff / #ffff00 / #00ff00, which ARE Word's
 * cyan, yellow and green exactly. Anything else — a colour that arrived on a
 * pasted card — snaps to the nearest named pen rather than being dropped.
 */

/**
 * Every value Word will accept for `w:highlight`, minus `none`. Typed as a
 * union rather than `string` so the docx writer rejects a typo at build time
 * instead of producing a file Word silently strips the highlighting from.
 */
export type WordHighlight =
  | "black" | "blue" | "cyan" | "darkBlue" | "darkCyan" | "darkGray" | "darkGreen"
  | "darkMagenta" | "darkRed" | "darkYellow" | "green" | "lightGray" | "magenta"
  | "red" | "white" | "yellow";

const PEN: Record<WordHighlight, [number, number, number]> = {
  black: [0x00, 0x00, 0x00],
  blue: [0x00, 0x00, 0xff],
  cyan: [0x00, 0xff, 0xff],
  darkBlue: [0x00, 0x00, 0x80],
  darkCyan: [0x00, 0x80, 0x80],
  darkGray: [0x80, 0x80, 0x80],
  darkGreen: [0x00, 0x80, 0x00],
  darkMagenta: [0x80, 0x00, 0x80],
  darkRed: [0x80, 0x00, 0x00],
  darkYellow: [0x80, 0x80, 0x00],
  green: [0x00, 0xff, 0x00],
  lightGray: [0xc0, 0xc0, 0xc0],
  magenta: [0xff, 0x00, 0xff],
  red: [0xff, 0x00, 0x00],
  white: [0xff, 0xff, 0xff],
  yellow: [0xff, 0xff, 0x00],
};

export const WORD_HIGHLIGHT_NAMES = Object.keys(PEN) as WordHighlight[];

function toRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * The named Word highlight closest to `hex`, or undefined when there is no
 * highlight to render. Distance is plain squared RGB — the palette is tiny and
 * far apart, so anything cleverer would pick the same name.
 *
 * `white` is deliberately reachable: a card can legitimately carry a white
 * highlight, and snapping it to `yellow` would invent emphasis the debater
 * never applied.
 */
export function wordHighlightName(hex: string | null | undefined): WordHighlight | undefined {
  if (!hex) return undefined;
  const rgb = toRgb(hex);
  if (!rgb) return undefined;

  let best: WordHighlight = "yellow";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const name of WORD_HIGHLIGHT_NAMES) {
    const [r, g, b] = PEN[name];
    const distance = (rgb[0] - r) ** 2 + (rgb[1] - g) ** 2 + (rgb[2] - b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}
