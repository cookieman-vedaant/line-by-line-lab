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

const WORD_CHAR = /[A-Za-z0-9]/;
const isWord = (ch: string | undefined): boolean => ch !== undefined && WORD_CHAR.test(ch);

/**
 * A span is word-boundary-clean when it doesn't slice through a word at either
 * edge — so needle "one" can't match inside "oneness", and short buzzwords
 * can't attach to neighbouring words.
 */
function isBoundaryClean(text: string, start: number, end: number): boolean {
  const cutsLeft = isWord(text[start - 1]) && isWord(text[start]);
  const cutsRight = isWord(text[end]) && isWord(text[end - 1]);
  return !cutsLeft && !cutsRight;
}

/** Find every word-boundary-clean raw-offset span of `needle` in the text. */
function locateSpans(
  index: ReturnType<typeof buildNormalizedIndex>,
  text: string,
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
    const rawEnd = Math.min(index.map[lastNormIdx] + 1, text.length);
    if (isBoundaryClean(text, rawStart, rawEnd)) spans.push([rawStart, rawEnd]);
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

  // Underlines are the read-aloud sentences (long, rarely repeated) — mark
  // every occurrence.
  for (const needle of underlines) {
    const spans = locateSpans(index, text, needle);
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

  // Highlights are the short stressed warrant phrases. Mark each phrase only
  // ONCE (deduped), at the occurrence that sits inside a read-aloud/underlined
  // sentence when possible — so a recurring keyword isn't lit up everywhere and
  // never lands stranded in un-read plain text.
  const seenHighlights = new Set<string>();
  for (const needle of highlights) {
    const key = normalizeForComparison(stripDelimiters(needle));
    if (seenHighlights.has(key)) continue; // duplicate phrase — skip silently
    seenHighlights.add(key);

    const spans = locateSpans(index, text, needle);
    if (spans.length === 0) {
      missed++;
      continue;
    }
    const chosen = spans.find(([start]) => marks[start] === UNDERLINE) ?? spans[0];
    applied++;
    for (let i = chosen[0]; i < chosen[1]; i++) {
      marks[i] = HIGHLIGHT;
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
