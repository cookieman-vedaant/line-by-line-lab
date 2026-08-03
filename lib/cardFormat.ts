import { parseCardMarkup, stripDelimiters } from "@/lib/cardMarkup";
import type { Card } from "@/types";

/**
 * User formatting layered over a cut card.
 *
 * The card's TEXT is immutable here by construction. A format is a set of marks
 * over character ranges, never an edit of the characters themselves, so no
 * amount of formatting can change what the author said. That is the whole reason
 * this is a range model instead of a contentEditable surface: a contentEditable
 * card would let a debater retype the evidence and still call it a cut card.
 *
 * Composition is a pure function of (card, spans) and produces runs, which the
 * preview, the clipboard HTML, and the .docx export all render from. One
 * composition, three renderers, so the download always matches the screen.
 */

export type CardField = "tag" | "cite" | "body";

/** Debate card sizes: shrunk context, read-aloud, and the tag. */
export const CONTEXT_PT = 8;
export const READ_PT = 11;
export const TAG_PT = 13;
export const FONT_SIZES = [5, 8, 11, 13] as const;

export const CARD_FONTS = [
  "Calibri",
  "Times New Roman",
  "Georgia",
  "Arial",
  "Garamond",
  "Verdana",
] as const;
export type CardFont = (typeof CARD_FONTS)[number];

/** One user override across a character range of one paragraph of one field. */
export interface FormatSpan {
  field: CardField;
  /** Paragraph index; body splits on blank lines, tag and cite are always 0. */
  para: number;
  start: number;
  end: number;
  bold?: boolean;
  underline?: boolean;
  /** Hex color to highlight with, or null to clear one. */
  highlight?: string | null;
  sizePt?: number;
}

/** Whole-card formatting state, serializable so it can be saved with the card. */
export interface CardFormat {
  font: CardFont;
  spans: FormatSpan[];
}

export const EMPTY_FORMAT: CardFormat = { font: "Calibri", spans: [] };

export interface CharAttr {
  bold: boolean;
  underline: boolean;
  highlight: string | null;
  sizePt: number;
}

export interface Run extends CharAttr {
  text: string;
  /** Shrunk, greyed context: unmarked text left small. Derived, never stored. */
  muted: boolean;
}

export function isMuted(a: CharAttr): boolean {
  return !a.bold && !a.underline && !a.highlight && a.sizePt <= CONTEXT_PT;
}

function attrFor(field: CardField, kind: "plain" | "underline" | "highlight", hex: string): CharAttr {
  if (field === "tag") {
    return { bold: true, underline: kind !== "plain", highlight: null, sizePt: TAG_PT };
  }
  if (field === "cite") {
    return { bold: true, underline: false, highlight: null, sizePt: READ_PT };
  }
  if (kind === "highlight") {
    return { bold: true, underline: true, highlight: hex, sizePt: READ_PT };
  }
  if (kind === "underline") {
    return { bold: false, underline: true, highlight: null, sizePt: READ_PT };
  }
  return { bold: false, underline: false, highlight: null, sizePt: CONTEXT_PT };
}

/**
 * Per-character attributes for one paragraph, before user overrides. Offsets are
 * UTF-16 code units, matching DOM Range offsets so a browser selection maps
 * straight onto this array.
 */
function baseAttrs(field: CardField, source: string, hex: string): { text: string; attrs: CharAttr[] } {
  const nodes = parseCardMarkup(source);
  let text = "";
  const attrs: CharAttr[] = [];
  for (const node of nodes) {
    const a = attrFor(field, node.kind, hex);
    text += node.text;
    for (let i = 0; i < node.text.length; i += 1) attrs.push({ ...a });
  }
  return { text, attrs };
}

function applySpans(attrs: CharAttr[], spans: FormatSpan[], field: CardField, para: number): void {
  for (const s of spans) {
    if (s.field !== field || s.para !== para) continue;
    const lo = Math.max(0, Math.min(s.start, s.end));
    const hi = Math.min(attrs.length, Math.max(s.start, s.end));
    for (let i = lo; i < hi; i += 1) {
      const a = attrs[i];
      if (s.bold !== undefined) a.bold = s.bold;
      if (s.underline !== undefined) a.underline = s.underline;
      if (s.highlight !== undefined) a.highlight = s.highlight;
      if (s.sizePt !== undefined) a.sizePt = s.sizePt;
    }
  }
}

function sameAttr(a: CharAttr, b: CharAttr): boolean {
  return (
    a.bold === b.bold &&
    a.underline === b.underline &&
    a.highlight === b.highlight &&
    a.sizePt === b.sizePt
  );
}

function toRuns(text: string, attrs: CharAttr[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const a = attrs[i];
    const last = runs[runs.length - 1];
    if (last && sameAttr(last, a)) {
      last.text += text[i];
    } else {
      runs.push({ ...a, text: text[i], muted: isMuted(a) });
    }
  }
  return runs;
}

function composeField(
  field: CardField,
  source: string,
  para: number,
  spans: FormatSpan[],
  hex: string,
): Run[] {
  const { text, attrs } = baseAttrs(field, source, hex);
  applySpans(attrs, spans, field, para);
  return toRuns(text, attrs);
}

export interface ComposedCard {
  tag: Run[];
  cite: Run[];
  citeDetails: string;
  /** One run list per body paragraph. */
  body: Run[][];
  font: CardFont;
}

/** Body paragraphs, split the same way everywhere so `para` indexes line up. */
export function bodyParagraphs(body: string): string[] {
  return body.split(/\n+/).filter((p) => p.trim().length > 0);
}

export function composeCard(card: Card, format: CardFormat, hex: string): ComposedCard {
  return {
    tag: composeField("tag", card.tag, 0, format.spans, hex),
    cite: composeField("cite", card.cite, 0, format.spans, hex),
    citeDetails: stripDelimiters(card.citeDetails),
    body: bodyParagraphs(card.body).map((p, i) => composeField("body", p, i, format.spans, hex)),
    font: format.font,
  };
}

/* ---------- toolbar actions ---------- */

export type ToggleMark = "bold" | "underline";

/**
 * What the toolbar should show as active for the current selection: a mark
 * counts as on only when every character in the range already has it, which is
 * what makes a second press turn it off rather than back on.
 */
export function activeMarks(runs: Run[], start: number, end: number): {
  bold: boolean;
  underline: boolean;
  highlight: boolean;
} {
  let pos = 0;
  let bold = true;
  let underline = true;
  let highlight = true;
  let seen = false;
  for (const run of runs) {
    const runStart = pos;
    const runEnd = pos + run.text.length;
    pos = runEnd;
    if (runEnd <= start || runStart >= end) continue;
    seen = true;
    if (!run.bold) bold = false;
    if (!run.underline) underline = false;
    if (!run.highlight) highlight = false;
  }
  return seen ? { bold, underline, highlight } : { bold: false, underline: false, highlight: false };
}

/** Append a span, or drop it if the range is empty. */
export function withSpan(format: CardFormat, span: FormatSpan): CardFormat {
  if (span.end <= span.start) return format;
  return { ...format, spans: [...format.spans, span] };
}

/** Clear every user override, returning the card to how it was cut. */
export function resetSpans(format: CardFormat): CardFormat {
  return { ...format, spans: [] };
}
