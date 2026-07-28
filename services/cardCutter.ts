import { z } from "zod";
import { tagMarkupToDelimiters } from "@/lib/cardMarkup";
import { applyEmphasis } from "@/lib/emphasis";
import { generateJson } from "@/lib/gemini";
import {
  ArticleUnreadableError,
  extractArticleFromUrl,
  type ExtractedArticle,
} from "@/services/articleExtract";
import type { Card, CardLength, CutRequest } from "@/types";

export { ArticleUnreadableError };

/** Honest failure — nothing in the article strongly proves the claim. */
export class NoWarrantFoundError extends Error {
  constructor() {
    super("Unable to identify a sufficiently strong argumentative passage.");
    this.name = "NoWarrantFoundError";
  }
}

// Keeps prompts inside free-tier token budgets; plenty for almost any article.
const MAX_ARTICLE_CHARS = 60000;

/**
 * HOW CUTTING WORKS (verbatim by construction — the AI never writes body text):
 * 1. Extract the article (URL via Readability, or pasted text).
 * 2. SELECT: the AI picks a contiguous paragraph range matching the card
 *    length; we clamp it mechanically to the length's word budget.
 *    The body is then assembled from the REAL article paragraphs.
 * 3. MARK: the AI returns exact substrings to underline/highlight plus the
 *    tag and cite; we locate each substring in the real text and wrap it.
 *    Substrings that don't match are skipped — never invented.
 */

/** Word-budget fraction of the article for each card length. */
const LENGTH_BUDGETS: Record<Exclude<CardLength, "Entire Article">, { min: number; max: number }> = {
  Short: { min: 0.05, max: 0.3 },
  Medium: { min: 0.35, max: 0.65 },
  Long: { min: 0.6, max: 0.95 },
};

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Clamp a selected paragraph range [start, end] (inclusive) so its share of
 * the article's words lands inside the budget. Expands the end first (then
 * the start) when too small; shrinks from the end when too large.
 */
export function fitRangeToBudget(
  wordCounts: number[],
  start: number,
  end: number,
  budget: { min: number; max: number },
): [number, number] {
  const total = wordCounts.reduce((a, b) => a + b, 0);
  if (total === 0) return [start, end];

  let s = Math.max(0, Math.min(start, wordCounts.length - 1));
  let e = Math.max(s, Math.min(end, wordCounts.length - 1));

  const fraction = () =>
    wordCounts.slice(s, e + 1).reduce((a, b) => a + b, 0) / total;

  // Too small → grow (end first, then start).
  while (fraction() < budget.min && (e < wordCounts.length - 1 || s > 0)) {
    if (e < wordCounts.length - 1) e++;
    else s--;
  }
  // Too large → shrink from the end (keep the selected opening).
  while (fraction() > budget.max && e > s) {
    e--;
  }
  return [s, e];
}

const selectorSchema = z.union([
  z.object({ startIndex: z.number().int().min(0), endIndex: z.number().int().min(0) }),
  z.object({ error: z.literal("no_warrant") }),
]);

const SELECTOR_SYSTEM = `You are the passage selector inside a debate card-cutting tool (Lincoln-Douglas). You receive a claim and an article split into numbered paragraphs. Pick the CONTIGUOUS run of paragraphs that best supports the claim at the requested card length.

Selection question: "If a debater could only read one section of this article, which section best proves this claim?" Optimize for the strongest WARRANT — the causal reasoning proving the claim — not the first or longest paragraph.

Card length targets (share of the article's total words):
- Short: the single strongest passage — roughly 5-30%.
- Medium: about HALF the article — the contiguous half that best supports the claim (35-65%).
- Long: the complete chain of reasoning — most of the article (60-95%).

If NOTHING in the article supports the claim, return {"error": "no_warrant"}.
Otherwise return ONLY JSON: {"startIndex": N, "endIndex": M} (inclusive paragraph indices).`;

const markerSchema = z.object({
  tag: z.string().min(1),
  cite: z.string().min(1),
  citeDetails: z.string().min(1),
  underlines: z.array(z.string()).max(300),
  highlights: z.array(z.string()).max(250),
});

const MARKER_SYSTEM = `You are the emphasis marker inside a debate card-cutting tool (Lincoln-Douglas). You receive a claim and a passage extracted VERBATIM from an article. You do NOT rewrite anything — you return metadata that the app applies to the original text.

Return ONLY JSON:
{"tag": "...", "cite": "...", "citeDetails": "...", "underlines": ["...", ...], "highlights": ["...", ...]}

Your #1 job is DETAILED, CLAIM-DRIVEN emphasis. Work through the passage from beginning to end and mark every place that supports the claim — do not stop after the first paragraph or two. A well-cut card is densely marked throughout, so the whole argument is visible at a glance.

- underlines: the read-aloud text — full clauses/sentences COPIED EXACTLY from the passage, character for character. Underline EVERY sentence or clause that bears on the claim, in EVERY paragraph that relates to it — aim for roughly 50-75% of the passage, distributed from start to finish (not clustered at the top). A debater reading only the underlined text should hear the complete argument for the claim. Each string must stay within one paragraph.
- highlights: the punchiest words INSIDE underlined stretches — the specific WARRANTS (the reasons/mechanisms that prove the claim), read with vocal emphasis. COPIED EXACTLY from the passage. Highlight generously — roughly half of the underlined text — and pull out MULTIPLE warrant phrases per paragraph wherever the reasoning is dense. Every distinct reason, mechanism, statistic, or causal link that supports the claim should be highlighted. The highlighted words read in sequence must still form a coherent, grammatical argument. Each string must stay within one paragraph.
- Prioritize by the claim: highlight most heavily the passages that most directly prove the user's claim. A phrase that states WHY or HOW the claim is true is always worth highlighting.
- tag: a punchy 1-2 sentence statement of what the evidence proves, phrased from the user's claim (this is YOUR wording). Mark 1-3 key phrases with __underline__ markers.
- cite: AuthorLastName YY, no apostrophe (e.g. "Rodrigues 16"). Multiple authors: "FirstAuthor et al. YY". No known author: publication name + YY.
- citeDetails: full cite content WITHOUT brackets: author (+ qualifications if known), "Article Title." Publication, date, URL if known.

Finding the author:
- Use the provided metadata author if present.
- If the metadata author is "unknown", look for the author's name stated in the CITE CONTEXT block (bylines like "By Jane Smith" or "Article written by: Jane Smith", often at the very top or bottom of an article), and use that.
- NEVER invent, guess, or infer an author name from the topic. If no author is genuinely stated anywhere, cite by the publication instead (e.g. "Reuters 25").
- Same rule for dates and credentials: use only what the metadata or cite context actually states.

Strings that don't match the passage exactly get silently dropped, so copy underlines/highlights with care — including punctuation and capitalization.`;

function buildMarkerPrompt(claim: string, article: ExtractedArticle, passage: string): string {
  // Bylines usually live at the very top or bottom of the article, which the
  // selected passage may exclude — give the model the head + tail for the cite.
  const head = article.text.slice(0, 500);
  const tail = article.text.length > 1000 ? article.text.slice(-500) : "";
  const citeContext = [head, tail].filter(Boolean).join("\n…\n");

  return [
    `Claim the card must support: ${claim}`,
    `Known metadata — title: ${article.title || "unknown"}; author: ${article.author || "unknown"}; publication: ${article.publication || "unknown"}; date: ${article.date || "unknown"}.`,
    "--- CITE CONTEXT (article start/end — for finding the author/date only, do NOT quote from here) ---",
    citeContext,
    "--- PASSAGE (verbatim from the article — underline/highlight ONLY from here) ---",
    passage,
  ].join("\n");
}

/** Resolve the cut source into clean article text + metadata. */
async function resolveSource(req: CutRequest): Promise<ExtractedArticle> {
  if (req.source.url) {
    const extracted = await extractArticleFromUrl(req.source.url);
    // User/search-supplied metadata wins over what the page scraper guessed.
    return {
      ...extracted,
      title: req.source.title || extracted.title,
      author: req.source.author || extracted.author,
      publication: req.source.publication || extracted.publication,
      date: req.source.date || extracted.date,
    };
  }
  return {
    title: req.source.title ?? "",
    author: req.source.author ?? "",
    publication: req.source.publication ?? "",
    date: req.source.date ?? "",
    text: (req.source.text ?? "").trim(),
  };
}

async function selectPassage(
  claim: string,
  cardLength: CardLength,
  paragraphs: string[],
): Promise<string> {
  // Entire Article: no selection — the whole text, formatting only.
  if (cardLength === "Entire Article" || paragraphs.length === 1) {
    return paragraphs.join("\n\n");
  }

  const budget = LENGTH_BUDGETS[cardLength];
  const wordCounts = paragraphs.map(countWords);

  const numbered = paragraphs.map((p, i) => `[${i}] ${p}`).join("\n\n");
  const raw = await generateJson({
    system: SELECTOR_SYSTEM,
    prompt: [
      `Claim: ${claim}`,
      `Card length: ${cardLength}`,
      `Paragraph count: ${paragraphs.length}`,
      "--- PARAGRAPHS ---",
      numbered,
    ].join("\n"),
    maxOutputTokens: 2048,
  });

  const parsed = selectorSchema.safeParse(raw);

  // Pick the seed range: the AI's choice if valid, else a mechanical default
  // (the strongest-density middle). Either way fitRangeToBudget enforces the
  // length — the specifier must work even when the selector glitches.
  let seedStart: number;
  let seedEnd: number;
  if (parsed.success && !("error" in parsed.data)) {
    seedStart = Math.min(parsed.data.startIndex, paragraphs.length - 1);
    seedEnd = Math.min(parsed.data.endIndex, paragraphs.length - 1);
  } else if (parsed.success) {
    // {error: "no_warrant"} — the article genuinely doesn't support the claim.
    throw new NoWarrantFoundError();
  } else {
    console.warn("cardCutter: unparseable selector output; using length-clamped default");
    // Seed at the article's start; the budget will size it correctly.
    seedStart = 0;
    seedEnd = 0;
  }

  const [start, end] = fitRangeToBudget(wordCounts, seedStart, seedEnd, budget);
  return paragraphs.slice(start, end + 1).join("\n\n");
}

/**
 * Cut a debate-ready card from a URL or pasted text.
 * The body is real article text with emphasis applied on top — the AI cannot
 * alter the wording because it never produces the wording.
 */
export async function cutCard(req: CutRequest): Promise<Card> {
  const article = await resolveSource(req);
  if (article.text.length < 200) {
    throw new ArticleUnreadableError(
      "That article text is too short to cut a card from. Paste the full article body.",
    );
  }
  if (article.text.length > MAX_ARTICLE_CHARS) {
    article.text = article.text.slice(0, MAX_ARTICLE_CHARS);
  }

  const paragraphs = splitParagraphs(article.text);
  const passage = await selectPassage(req.claim, req.cardLength, paragraphs);

  const markerRaw = await generateJson({
    system: MARKER_SYSTEM,
    prompt: buildMarkerPrompt(req.claim, article, passage),
    // Dense emphasis on a long/entire card means many substrings — give the
    // JSON room so it isn't truncated (which would drop later warrants).
    maxOutputTokens: 40000,
  });
  const marker = markerSchema.safeParse(markerRaw);
  if (!marker.success) {
    console.error("cardCutter: unparseable marker output");
    throw new Error("Card cutting finished but returned an unreadable result. Please try again.");
  }

  const { body, missed, applied } = applyEmphasis(
    passage,
    marker.data.underlines,
    marker.data.highlights,
  );
  if (missed > 0) {
    console.warn(`cardCutter: ${missed} emphasis substrings didn't match and were skipped (${applied} applied)`);
  }

  return {
    // The tag is the one place the AI supplies markup (`__key phrase__`);
    // convert it to internal delimiters. The body already carries them.
    tag: tagMarkupToDelimiters(marker.data.tag),
    cite: marker.data.cite,
    citeDetails: marker.data.citeDetails,
    body,
  };
}
