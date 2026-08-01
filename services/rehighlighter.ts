import { tagMarkupToDelimiters } from "@/lib/cardMarkup";
import { applyEmphasis } from "@/lib/emphasis";
import { normalizeForComparison } from "@/lib/verbatim";
import { appendSourceUrl } from "@/services/cardCutter";
import type { ExtractedArticle } from "@/services/articleExtract";
import type {
  Contradiction,
  ContradictionKind,
  RehighlightResult,
  RehighlightSource,
} from "@/types";

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

/** The AI's raw analysis (validated by the route/service Zod schema). */
export interface RehighlightAnalysis {
  tag: string;
  cite: string;
  citeDetails: string;
  underlines: string[];
  highlights: string[];
  contradictions: Array<{
    quote: string;
    kind: ContradictionKind;
    explanation: string;
    howToUse: string;
  }>;
}

/**
 * Assemble the final result from the real article + the AI analysis.
 * No-fabrication happens HERE and is verifiable:
 *   • body = REAL article text with emphasis applied on top (applyEmphasis
 *     locates each underline/highlight substring and drops non-matches);
 *   • every contradiction whose quote is not verbatim in the article is dropped.
 * The AI never supplies body text — only substrings we locate — so the body is
 * verbatim by construction.
 */
export function buildRehighlightResult(
  article: ExtractedArticle,
  analysis: RehighlightAnalysis,
  sourceUrl?: string,
  notice?: string,
): RehighlightResult {
  const { body } = applyEmphasis(article.text, analysis.underlines, analysis.highlights);

  const contradictions: Contradiction[] = analysis.contradictions.filter((c) =>
    isVerbatimQuote(c.quote, article.text),
  );

  return {
    card: {
      tag: tagMarkupToDelimiters(analysis.tag),
      cite: analysis.cite,
      // The real link is appended here (never by the AI), so it can't be invented.
      citeDetails: appendSourceUrl(analysis.citeDetails, sourceUrl),
      body,
    },
    contradictions,
    articleTitle: article.title,
    sourceUrl,
    notice,
  };
}
