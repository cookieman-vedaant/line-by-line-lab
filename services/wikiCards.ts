import {
  BOLD_CLOSE,
  BOLD_OPEN,
  HIGHLIGHT_CLOSE,
  HIGHLIGHT_OPEN,
  stripDelimiters,
  UNDERLINE_CLOSE,
  UNDERLINE_OPEN,
} from "@/lib/cardMarkup";
import type { DocxParagraph, DocxRun } from "@/lib/docx";
import type { Card } from "@/types";

/**
 * Turn a disclosed debate document into the cards inside it.
 *
 * A debate file is not prose — it is a stack of cards, and it already carries
 * every distinction our own Card format has. The original debater underlined
 * what they read, highlighted the key warrants, and shrank the context they
 * skip. So this doesn't interpret anything: it maps THEIR formatting onto the
 * same internal markup our Card Cutter emits, and the existing `CardView`
 * renders it unchanged.
 *
 * That mapping is the whole design. It means a card mined from the wiki looks
 * and exports exactly like a card we cut ourselves, and it means **no text is
 * ever generated** — every word, and every emphasis mark, comes from the file.
 *
 * There is no AI in this file and there must not be. The card was already cut
 * by a human; our job is to find its boundaries, not to re-cut it.
 */

/** Word's built-in heading styles, plus the ones debate templates ship with. */
const HEADING_STYLE = /^(heading[1-9]|title|subtitle|hat|block|pocket|tag)$/i;

/**
 * A cite line looks like "Smith 21" or "Smith '21" or "Smith et al. 2019" near
 * the start of the paragraph. Deliberately loose: a missed cite costs us a
 * blank cite field, while a false positive would eat a body paragraph.
 */
const CITE_PATTERN = /^[^.\n]{0,80}?[A-Z][A-Za-z'’-]+[^.\n]{0,60}?['’]?\s?(?:\d{2}|\d{4})\b/;

export interface ExtractedCards {
  cards: Card[];
  /** Total paragraphs seen — lets the caller explain an empty result honestly. */
  paragraphs: number;
}

/** Is this paragraph acting as a heading (a tag), rather than body text? */
function isHeading(p: DocxParagraph): boolean {
  if (p.style && HEADING_STYLE.test(p.style.replace(/\s+/g, ""))) return true;
  // Many debaters never apply a style — they just bold the tag line. Treat a
  // short, fully-bold, entirely-unhighlighted paragraph as a tag.
  if (p.text.length > 300) return false;
  const meaningful = p.runs.filter((r) => r.text.trim().length > 0);
  if (meaningful.length === 0) return false;
  return meaningful.every((r) => r.bold && !r.highlighted);
}

/**
 * Does this paragraph contain read-aloud emphasis?
 *
 * This is what separates a real card from an analytic or a block of tags: a cut
 * card always has something underlined or highlighted, because that is what the
 * debater reads. A card with nothing emphasized isn't evidence, it's an
 * argument the debater wrote.
 */
function hasEmphasis(p: DocxParagraph): boolean {
  return p.runs.some((r) => (r.underline || r.highlighted) && r.text.trim().length > 0);
}

/**
 * One run → internal markup.
 *
 * The three layers map directly:
 *   highlighted        → highlight (read aloud, stressed)
 *   underlined         → underline (read aloud)
 *   neither            → plain (context, rendered small and grey)
 * with bold as a separate axis that only survives ON emphasized text, matching
 * the invariant `lib/cardMarkup.ts` enforces.
 */
function runToMarkup(run: DocxRun): string {
  // Delimiters are private-use characters that cannot occur in real prose, but
  // strip defensively so a pathological file can't inject emphasis.
  const text = stripDelimiters(run.text);
  if (!text) return "";

  const emphasized = run.highlighted || run.underline;
  if (!emphasized) return text;

  const inner = run.bold ? `${BOLD_OPEN}${text}${BOLD_CLOSE}` : text;
  return run.highlighted
    ? `${HIGHLIGHT_OPEN}${inner}${HIGHLIGHT_CLOSE}`
    : `${UNDERLINE_OPEN}${inner}${UNDERLINE_CLOSE}`;
}

function paragraphToMarkup(p: DocxParagraph): string {
  return p.runs.map(runToMarkup).join("");
}

/**
 * Pull the cite out of a card's body paragraphs.
 *
 * Convention is a short line naming author and year, usually bold, sitting
 * between the tag and the evidence. Returns the paragraph index so the caller
 * can keep it out of the body.
 */
function findCite(body: DocxParagraph[]): { index: number; cite: string; details: string } | null {
  // Only look at the top of the card: a later "Smith 21" is a citation inside
  // the evidence, not this card's cite line.
  for (let i = 0; i < Math.min(body.length, 3); i++) {
    const p = body[i];
    if (hasEmphasis(p) && p.text.length > 200) continue; // that's the evidence
    const text = p.text.trim();
    if (!CITE_PATTERN.test(text)) continue;

    // The bold head is the short cite ("Smith 21"); the rest is the full cite.
    const boldHead = p.runs
      .filter((r) => r.bold)
      .map((r) => r.text)
      .join("")
      .trim();
    const short = boldHead || text.split(/[,;[]/)[0];
    const details = text.slice(short.length).replace(/^[\s,;[\]]+/, "").trim();
    return { index: i, cite: stripDelimiters(short).slice(0, 120), details: stripDelimiters(details) };
  }
  return null;
}

/**
 * Group a document into cards.
 *
 * Walks paragraphs, treating headings as boundaries: everything between one
 * heading and the next belongs to that heading. A group only becomes a card if
 * its body actually contains read-aloud emphasis, which filters out tables of
 * contents, roadmaps, and blocks of pure analytics.
 */
export function extractCards(paragraphs: DocxParagraph[], sourceUrl?: string): ExtractedCards {
  const cards: Card[] = [];
  let tag: string | null = null;
  let body: DocxParagraph[] = [];

  const flush = () => {
    const evidence = body.filter((p) => p.text.trim().length > 0);
    if (evidence.length > 0 && evidence.some(hasEmphasis)) {
      const found = findCite(evidence);
      const bodyParas = evidence.filter((_, i) => i !== found?.index);
      if (bodyParas.length > 0) {
        cards.push({
          // The tag is the debater's own heading; when a card has none (loose
          // evidence under a section), fall back to the cite rather than
          // inventing a description of the argument.
          tag: stripDelimiters(tag ?? found?.cite ?? "Untitled card"),
          cite: found?.cite ?? "",
          citeDetails: [found?.details, sourceUrl].filter(Boolean).join(" ").trim(),
          body: bodyParas.map(paragraphToMarkup).join("\n"),
        });
      }
    }
    body = [];
  };

  for (const p of paragraphs) {
    if (isHeading(p)) {
      flush();
      tag = p.text.trim();
      continue;
    }
    body.push(p);
  }
  flush();

  return { cards, paragraphs: paragraphs.length };
}

/**
 * Keep the cards that actually relate to what the user searched for.
 *
 * A disclosed file can hold dozens of cards and only one is the reason it
 * matched. Scoring is plain term overlap — no model call, no reordering by
 * anything but the user's own words.
 */
export function rankCardsForQuery(cards: Card[], query: string, limit = 25): Card[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return cards.slice(0, limit);

  const scored = cards.map((card) => {
    const tag = card.tag.toLowerCase();
    const body = stripDelimiters(card.body).toLowerCase();
    let score = 0;
    for (const term of terms) {
      // A hit in the tag says the whole card is about this; a hit in the body
      // may just be a passing mention, so it counts for less.
      if (tag.includes(term)) score += 3;
      if (body.includes(term)) score += 1;
    }
    return { card, score };
  });

  const matching = scored.filter((s) => s.score > 0);
  // Nothing matched by name: the file matched on text we can't see (Solr
  // searched the whole document), so return it in document order rather than
  // claiming there's nothing here.
  const chosen = matching.length > 0 ? matching : scored;
  return [...chosen]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.card);
}
