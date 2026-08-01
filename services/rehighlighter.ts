import { z } from "zod";
import { tagMarkupToDelimiters } from "@/lib/cardMarkup";
import { applyEmphasis } from "@/lib/emphasis";
import {
  GEMINI_MARKER_MODEL,
  GEMINI_MODEL,
  RateLimitedError,
  generateJson,
} from "@/lib/gemini";
import { createSharedCache } from "@/lib/sharedCache";
import { normalizeForComparison } from "@/lib/verbatim";
import { appendSourceUrl } from "@/services/cardCutter";
import {
  ArticleUnreadableError,
  extractArticleCached,
  type ExtractedArticle,
} from "@/services/articleExtract";
import type {
  Contradiction,
  ContradictionKind,
  RehighlightRequest,
  RehighlightResult,
  RehighlightSource,
} from "@/types";

export { ArticleUnreadableError };

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

// Analyze the WHOLE article for contradictions (same cap as the cutter — ~20k
// words fits Gemini Flash + the free-tier token budget).
const MAX_ARTICLE_CHARS = 120000;

const analysisSchema = z.object({
  tag: z.string().min(1),
  cite: z.string().min(1),
  citeDetails: z.string().min(1),
  underlines: z.array(z.string()).max(300).default([]),
  highlights: z.array(z.string()).max(400).default([]),
  contradictions: z
    .array(
      z.object({
        quote: z.string().min(1),
        kind: z.enum(["contradiction", "omitted_context", "author_hedge", "miscut"]),
        explanation: z.string().min(1),
        howToUse: z.string().min(1),
      }),
    )
    .max(20)
    .default([]),
});

const REHIGHLIGHT_SYSTEM = `You are the analyst inside a debate tool called the Card Re-Highlighter (Lincoln-Douglas). A debater gives you (1) an OPPONENT'S CLAIM — the tag their card is trying to prove — and (2) the FULL original article that card was cut from. Opponents cut cards to say exactly what they want; the fuller article often hedges, qualifies, contradicts itself, or omits context that flips the card. Your job: find, IN THE AUTHOR'S OWN WORDS, where the article UNDERCUTS the opponent's claim, so the debater can turn the source against them.

You do NOT rewrite or paraphrase anything you quote. Every quote and every emphasis substring must be COPIED EXACTLY (verbatim) from the article — the app verifies each one against the real text and SILENTLY DROPS any that doesn't match, so copy with care (punctuation, capitalization, spacing).

Return ONLY JSON with this exact shape:
{"tag":"...","cite":"...","citeDetails":"...","underlines":["..."],"highlights":["..."],"contradictions":[{"quote":"...","kind":"contradiction|omitted_context|author_hedge|miscut","explanation":"...","howToUse":"..."}]}

contradictions — the heart of the tool. Each item exposes ONE place the article works against the opponent's claim:
- quote: a VERBATIM sentence (or two) from the article — the author's own words that undercut the claim.
- kind: one of
    "contradiction"   — the article states or clearly implies the opposite of the claim.
    "omitted_context" — nearby context the card cut out that changes what the quoted part means.
    "author_hedge"    — the author qualifies/limits/conditions the claim (only, may, in some cases, short-term...).
    "miscut"          — the card's highlighting misrepresents what the sentence actually says in context.
- explanation: 1-2 sentences of YOUR analysis of the real text — why this undercuts the opponent's claim. Reasoning about the text is allowed; it is NOT new evidence.
- howToUse: one sentence on how to deploy it in-round (e.g. "Read this in the 1AR to show their own author concedes the effect is short-term.").
Include ONLY genuine, defensible items. If the article honestly supports the opponent's claim and you cannot find a real contradiction, hedge, omission, or miscut, return "contradictions": [] — DO NOT manufacture a weakness. An empty list is a valid, honest answer.

underlines / highlights — the passages to re-highlight so the debater can READ the indict aloud:
- underlines: full clauses/sentences COPIED EXACTLY from the article — the counter-warrant text to read (usually the same sentences you quoted, plus the reasoning around them). Each string stays within ONE paragraph.
- highlights: the load-bearing phrases WITHIN the underlined sentences — coherent 3-10 word phrases (keep the key term together with what is said about it), never lone buzzwords, each highlighted ONCE. Copy exactly.
If contradictions is empty, return empty underlines and highlights too.

tag: a punchy 1-2 sentence statement, in YOUR words, of what the re-highlight proves against the opponent (e.g. "The opponent's own source admits the effect is small and short-lived."). Mark 1-3 key phrases with __double-underscores__.

cite / citeDetails — identify the article's HUMAN author:
- cite: author last name + 2-digit year, no apostrophe ("Smith 24"). Multiple authors: "FirstAuthorLastName et al. YY". Only when NO human author is stated anywhere: publication + YY.
- citeDetails: full cite content WITHOUT brackets: author (+ qualifications if known), "Article Title." Publication, date. Do NOT include a URL — the app appends the real link itself.
Finding the author (name the PERSON, never the website): use the provided metadata author when it is a person's name; if it is an organization or matches the publication, ignore it and look for a human byline ("By Jane Smith") in the CITE CONTEXT; NEVER invent an author — if none is stated, cite by the publication.`;

function buildAnalysisPrompt(claim: string, article: ExtractedArticle): string {
  // Bylines usually sit at the very top or bottom; give the model head + tail for the cite.
  const head = article.text.slice(0, 800);
  const tail = article.text.length > 1300 ? article.text.slice(-500) : "";
  const citeContext = [head, tail].filter(Boolean).join("\n…\n");
  return [
    `Opponent's claim (the tag their card is trying to prove): ${claim || "(not given — infer it from the article)"}`,
    `Known metadata — title: ${article.title || "unknown"}; author: ${article.author || "unknown"}; publication: ${article.publication || "unknown"}; date: ${article.date || "unknown"}.`,
    "--- CITE CONTEXT (article start/end — for finding the author/date only, do NOT quote from here) ---",
    citeContext,
    "--- FULL ARTICLE (verbatim — quote/underline/highlight ONLY from here) ---",
    article.text,
  ].join("\n");
}

/** Resolve the request into article text + (optional) real URL + (optional) honesty notice. */
async function resolveSource(
  req: RehighlightRequest,
): Promise<{ article: ExtractedArticle; sourceUrl?: string; notice?: string }> {
  const s = req.source;

  if (s.url) {
    return { article: await extractArticleCached(s.url), sourceUrl: s.url };
  }

  if (s.card?.trim()) {
    const url = parseUrlFromCard(s.card);
    if (url) {
      try {
        return { article: await extractArticleCached(url), sourceUrl: url };
      } catch (err) {
        if (!(err instanceof ArticleUnreadableError)) throw err;
        // Fetch failed (paywall/blocked) — fall through to reading the card body.
      }
    }
    return {
      article: { title: "", author: "", publication: "", date: "", text: s.card.trim() },
      notice: url
        ? "Couldn't fetch the full article — analyzed only the pasted card, so contradictions are limited to what's inside it."
        : "No source link in the card — analyzed only the pasted card text. Paste the article's URL for a full re-highlight.",
    };
  }

  if (s.text?.trim()) {
    return {
      article: {
        title: s.title ?? "",
        author: s.author ?? "",
        publication: s.publication ?? "",
        date: s.date ?? "",
        text: s.text.trim(),
      },
    };
  }

  throw new ArticleUnreadableError("Provide the opponent's card, a source URL, or the article text.");
}

async function runRehighlight(req: RehighlightRequest): Promise<RehighlightResult> {
  const { article, sourceUrl, notice } = await resolveSource(req);
  if (article.text.length < 200) {
    throw new ArticleUnreadableError(
      "That article text is too short to re-highlight. Paste the opponent's card, a URL, or the full article text.",
    );
  }
  if (article.text.length > MAX_ARTICLE_CHARS) {
    article.text = article.text.slice(0, MAX_ARTICLE_CHARS);
  }

  const claim = deriveOpponentClaim(req.source, req.opponentClaim);
  const prompt = buildAnalysisPrompt(claim, article);

  // One quality-critical AI call. Fail fast on the premium model (it gets the
  // "high demand" 503s) and drop to the reliable default — exactly like the cutter.
  let raw: unknown;
  try {
    raw = await generateJson({
      system: REHIGHLIGHT_SYSTEM,
      prompt,
      model: GEMINI_MARKER_MODEL,
      maxOutputTokens: 40000,
      retries: GEMINI_MARKER_MODEL !== GEMINI_MODEL ? 0 : undefined,
    });
  } catch (err) {
    if (err instanceof RateLimitedError && GEMINI_MARKER_MODEL !== GEMINI_MODEL) {
      console.warn("rehighlighter: marker model busy; falling back to the default model");
      raw = await generateJson({
        system: REHIGHLIGHT_SYSTEM,
        prompt,
        model: GEMINI_MODEL,
        maxOutputTokens: 40000,
      });
    } else {
      throw err;
    }
  }

  const parsed = analysisSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("rehighlighter: unparseable analysis output");
    throw new Error("Re-highlight finished but returned an unreadable result. Please try again.");
  }

  return buildRehighlightResult(article, parsed.data, sourceUrl, notice);
}

// Re-highlighting the same source+claim reuses the result for 30 min — $0 on repeats.
const rehighlightCache = createSharedCache<RehighlightResult>({
  ttlMs: 30 * 60 * 1000,
  namespace: "rehighlight",
  maxLocal: 30,
});

/** Tiny non-crypto string hash — just to key the cache on pasted card/text. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function cacheKey(req: RehighlightRequest): string {
  const s = req.source;
  const src = s.url ?? (s.card ? `card:${hash(s.card)}` : `text:${hash(s.text ?? "")}`);
  return `${src}|${(req.opponentClaim ?? "").trim().toLowerCase()}`;
}

/** Re-highlight an opponent's card from its own source (cached). */
export async function rehighlight(req: RehighlightRequest): Promise<RehighlightResult> {
  return rehighlightCache.wrap(cacheKey(req), () => runRehighlight(req));
}
