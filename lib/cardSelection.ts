import type { CardField } from "@/lib/cardFormat";

/**
 * Maps a browser text selection onto (field, paragraph, character range) inside
 * a rendered card, so the toolbar can format exactly what the debater selected.
 *
 * Offsets are UTF-16 code units measured from the start of the field block,
 * which is what lib/cardFormat's per-character arrays are indexed by.
 */

export interface FieldSelection {
  field: CardField;
  para: number;
  start: number;
  end: number;
}

function fieldBlock(node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  while (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentNode;
  return (el as HTMLElement | null)?.closest("[data-field]") ?? null;
}

/**
 * Distance in characters from the start of `block` to a range boundary.
 * Measured with a Range rather than a manual text-node walk, so an anchor on an
 * element boundary (which carries a child index, not a text offset) is handled
 * the same as one inside a text node.
 */
function offsetWithin(block: HTMLElement, container: Node, offset: number): number {
  const probe = document.createRange();
  probe.selectNodeContents(block);
  try {
    probe.setEnd(container, offset);
  } catch {
    return 0; // boundary outside the block; treat as the start
  }
  return probe.toString().length;
}

/** The current selection, or null if there isn't one inside a single field. */
export function readSelection(root: HTMLElement): FieldSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  const block = fieldBlock(range.startContainer);
  // A selection that crosses paragraphs has no single character range to mark.
  if (!block || block !== fieldBlock(range.endContainer) || !root.contains(block)) return null;

  const field = block.dataset.field as CardField | undefined;
  if (field !== "tag" && field !== "cite" && field !== "body") return null;

  const start = offsetWithin(block, range.startContainer, range.startOffset);
  const end = offsetWithin(block, range.endContainer, range.endOffset);
  if (end <= start) return null;

  return { field, para: Number(block.dataset.para ?? 0), start, end };
}
