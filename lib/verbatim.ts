/**
 * The programmatic no-fabrication guarantee: because the app holds the full
 * article text server-side, every card body can be checked against it.
 * A card that isn't verbatim gets rejected — never shown to the user.
 *
 * Card markup conventions (see types/index.ts):
 *   ==text==   highlighted key warrant (cyan + bold + underline)
 *   __text__   underlined read-aloud text
 *   [...]      omitted text
 */

/** Strip emphasis markers, leaving the raw quoted text plus [...] markers. */
export function stripMarkup(body: string): string {
  return body.replaceAll("==", "").replaceAll("__", "");
}

/**
 * Normalize text for comparison: unify quotes/dashes/ellipses and whitespace.
 * Web pages and models disagree on typography; meaning-preserving differences
 * must not fail verification, while wording changes must.
 */
export function normalizeForComparison(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * A normalized view of a text with a map back to raw character offsets,
 * so a normalized substring match can be applied to the ORIGINAL text.
 */
export interface NormalizedIndex {
  norm: string;
  /** map[i] = index in the raw string of the char that produced norm[i]. */
  map: number[];
}

const CHAR_MAP: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "ʼ": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  " ": " ",
};

/** Build a normalized index consistent with normalizeForComparison(). */
export function buildNormalizedIndex(raw: string): NormalizedIndex {
  const normChars: string[] = [];
  const map: number[] = [];

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const mapped = CHAR_MAP[ch] ?? ch;

    if (/\s/.test(mapped)) {
      // Collapse whitespace runs; skip leading whitespace entirely.
      if (normChars.length === 0 || normChars[normChars.length - 1] === " ") continue;
      normChars.push(" ");
      map.push(i);
      continue;
    }

    for (const outChar of mapped.toLowerCase()) {
      normChars.push(outChar);
      map.push(i);
    }
  }

  // Trim trailing space.
  while (normChars.length > 0 && normChars[normChars.length - 1] === " ") {
    normChars.pop();
    map.pop();
  }

  return { norm: normChars.join(""), map };
}

export interface VerbatimResult {
  ok: boolean;
  /** The first card chunk that does not appear in the source (when !ok). */
  failedChunk?: string;
}

/**
 * Verify every contiguous chunk of the card body (between [...] omissions)
 * appears verbatim in the source text.
 */
export function verifyVerbatim(cardBody: string, sourceText: string): VerbatimResult {
  const source = normalizeForComparison(sourceText);

  const chunks = stripMarkup(cardBody)
    .split(/\[\s*(?:\.\.\.|…)\s*\]/)
    .map((chunk) => normalizeForComparison(chunk))
    .filter((chunk) => chunk.length > 0);

  for (const chunk of chunks) {
    if (!source.includes(chunk)) {
      return { ok: false, failedChunk: chunk.slice(0, 120) };
    }
  }
  return { ok: true };
}
