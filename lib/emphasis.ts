import {
  HIGHLIGHT_CLOSE,
  HIGHLIGHT_OPEN,
  stripDelimiters,
  UNDERLINE_CLOSE,
  UNDERLINE_OPEN,
} from "@/lib/cardMarkup";
import { buildNormalizedIndex, normalizeForComparison } from "@/lib/verbatim";

/**
 * Apply emphasis to REAL article text. The AI never writes card body text —
 * it only names substrings to underline/highlight. We locate each substring
 * (tolerant of quote/whitespace differences) and wrap it with the internal
 * private-use delimiters (see lib/cardMarkup.ts) so that literal `==` / `__`
 * in the article are never mistaken for markers.
 * Substrings that can't be located are skipped, never invented.
 * Verbatim is therefore guaranteed BY CONSTRUCTION.
 */

const PLAIN = 0;
const UNDERLINE = 1;
const HIGHLIGHT = 2;

export interface EmphasisResult {
  body: string;
  /** How many requested substrings could not be located (skipped). */
  missed: number;
  /** How many were applied. */
  applied: number;
}

/** Find every raw-offset span of `needle` in the indexed text. */
function locateSpans(
  index: ReturnType<typeof buildNormalizedIndex>,
  rawLength: number,
  needle: string,
): Array<[number, number]> {
  // Needles are plain copied text (they may legitimately contain `==`/`__`,
  // e.g. code or snake_case). Only strip our internal delimiters defensively —
  // those can never occur in real article text.
  const normNeedle = normalizeForComparison(stripDelimiters(needle));
  if (normNeedle.length < 3) return [];

  const spans: Array<[number, number]> = [];
  let from = 0;
  while (from <= index.norm.length - normNeedle.length) {
    const at = index.norm.indexOf(normNeedle, from);
    if (at === -1) break;
    const rawStart = index.map[at];
    const lastNormIdx = at + normNeedle.length - 1;
    const rawEnd = Math.min(index.map[lastNormIdx] + 1, rawLength);
    spans.push([rawStart, rawEnd]);
    from = at + normNeedle.length;
  }
  return spans;
}

/**
 * Mark `text` with underline/highlight markers. Overlaps resolve in favor of
 * highlights. Markers never span line breaks (they close and reopen).
 */
export function applyEmphasis(
  text: string,
  underlines: string[],
  highlights: string[],
): EmphasisResult {
  // Guard against the (astronomically unlikely) case of the source already
  // containing our private-use delimiters, so none can leak through as marks.
  text = stripDelimiters(text);
  const index = buildNormalizedIndex(text);
  const marks = new Uint8Array(text.length); // PLAIN by default

  let missed = 0;
  let applied = 0;

  for (const needle of underlines) {
    const spans = locateSpans(index, text.length, needle);
    if (spans.length === 0) {
      missed++;
      continue;
    }
    applied++;
    for (const [start, end] of spans) {
      for (let i = start; i < end; i++) {
        if (marks[i] < UNDERLINE) marks[i] = UNDERLINE;
      }
    }
  }

  for (const needle of highlights) {
    const spans = locateSpans(index, text.length, needle);
    if (spans.length === 0) {
      missed++;
      continue;
    }
    applied++;
    for (const [start, end] of spans) {
      for (let i = start; i < end; i++) {
        marks[i] = HIGHLIGHT;
      }
    }
  }

  // Emit text with markers, closing/reopening at line breaks.
  const out: string[] = [];
  let current = PLAIN;

  const close = () => {
    if (current === HIGHLIGHT) out.push(HIGHLIGHT_CLOSE);
    else if (current === UNDERLINE) out.push(UNDERLINE_CLOSE);
    current = PLAIN;
  };
  const open = (mark: number) => {
    if (mark === HIGHLIGHT) out.push(HIGHLIGHT_OPEN);
    else if (mark === UNDERLINE) out.push(UNDERLINE_OPEN);
    current = mark;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // Whitespace (esp. newlines) stays outside markers so they never span breaks.
    const effective = ch === "\n" ? PLAIN : marks[i];
    if (effective !== current) {
      close();
      if (effective !== PLAIN) open(effective);
    }
    out.push(ch);
  }
  close();

  return { body: out.join(""), missed, applied };
}
