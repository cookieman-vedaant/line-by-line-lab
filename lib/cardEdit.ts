import { CARD_INK_HEX } from "@/lib/cardRich";

/**
 * Editing commands for the card surface.
 *
 * The card is a real editable document, so these drive the browser's own editing
 * engine rather than a parallel model. execCommand is deprecated and has no
 * standard replacement; it remains the only cross-browser way to get correct
 * toggle-off, multi-node selection, and undo integration, which is exactly the
 * behaviour a word processor is expected to have.
 *
 * Font size is the exception: execCommand's fontSize only accepts the legacy
 * 1-7 scale, and debate cards are specified in points, so that one wraps the
 * selection itself.
 */

/** Emit spans with inline CSS instead of legacy <font> tags. */
export function enableCssStyling(): void {
  try {
    document.execCommand("styleWithCSS", false, "true");
  } catch {
    /* not supported; commands still work, just with legacy markup */
  }
}

function run(command: string, value?: string): void {
  enableCssStyling();
  try {
    document.execCommand(command, false, value);
  } catch {
    /* ignore: nothing selected, or the surface isn't focused */
  }
}

export const toggleBold = () => run("bold");
export const toggleItalic = () => run("italic");
export const toggleUnderline = () => run("underline");
export const setFontFamily = (name: string) => run("fontName", name);
export const setTextColor = (hex: string) => run("foreColor", hex);

/** `null` clears the highlight. */
export const setHighlight = (hex: string | null) => run("hiliteColor", hex ?? "transparent");

export function queryActive(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

/**
 * Set the selection to an exact point size.
 *
 * Descendant font sizes are cleared as well, otherwise an inner span from an
 * earlier edit keeps its own size and the change appears to do nothing to part
 * of the selection.
 *
 * Colour is set explicitly to black, at EVERY size. Shrinking text used to also
 * grey it, on the theory that context reads muted — but a card is black ink on
 * white, and size alone marks what you don't read aloud (see CARD_INK_HEX).
 * Setting it explicitly rather than leaving it unset matters: the selection may
 * already sit inside a grey span from an older card, and only an explicit value
 * overrides that.
 */
export function setSizePt(pt: number): void {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  const wrapper = document.createElement("span");
  wrapper.style.fontSize = `${pt}pt`;
  wrapper.style.color = CARD_INK_HEX;

  try {
    wrapper.appendChild(range.extractContents());
  } catch {
    return;
  }
  for (const el of wrapper.querySelectorAll<HTMLElement>("[style]")) {
    el.style.fontSize = "";
    el.style.color = "";
  }
  range.insertNode(wrapper);

  // Keep the same text selected so the next command applies to it too.
  const after = document.createRange();
  after.selectNodeContents(wrapper);
  sel.removeAllRanges();
  sel.addRange(after);
}
