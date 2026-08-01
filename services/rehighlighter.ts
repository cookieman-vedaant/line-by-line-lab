import { normalizeForComparison } from "@/lib/verbatim";
import type { RehighlightSource } from "@/types";

/**
 * Pull the first http(s) URL out of a pasted opponent card. Our cites now end
 * with the real source link (appendSourceUrl), so a pasted card usually carries
 * the URL of the article it was cut from. Trailing sentence punctuation is
 * trimmed so "...x." yields "...x".
 */
export function parseUrlFromCard(card: string): string | undefined {
  const m = card.match(/https?:\/\/[^\s\])>"']+/);
  if (!m) return undefined;
  return m[0].replace(/[.,;:]+$/, "");
}

/**
 * The opponent's claim to re-highlight against: an explicit field wins; else the
 * pasted card's TAG (its first non-empty line); else "" (the model infers it).
 */
export function deriveOpponentClaim(source: RehighlightSource, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  const card = source.card?.trim();
  if (card) {
    const firstLine = card
      .split(/\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (firstLine) return firstLine;
  }
  return "";
}

/**
 * True when `quote` appears verbatim in `sourceText`, tolerant of the same
 * quote/dash/whitespace typography differences the card verifier allows. Quotes
 * shorter than 8 normalized chars are rejected as too weak to be "verbatim".
 */
export function isVerbatimQuote(quote: string, sourceText: string): boolean {
  const q = normalizeForComparison(quote);
  if (q.length < 8) return false;
  return normalizeForComparison(sourceText).includes(q);
}
