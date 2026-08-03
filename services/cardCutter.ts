import { z } from "zod";
import { tagMarkupToDelimiters } from "@/lib/cardMarkup";
import { applyEmphasis } from "@/lib/emphasis";
import { GEMINI_MARKER_MODEL, GEMINI_MODEL, RateLimitedError, generateJson } from "@/lib/gemini";
import { createSharedCache } from "@/lib/sharedCache";
import {
  ArticleUnreadableError,
  extractArticleCached,
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

// Upper bound on the article text the selector analyzes. Big enough that the
// WHOLE of a long piece is considered (~20k words) so the strongest warrant is
// never truncated away; still well within Gemini Flash's context and the
// free-tier token budgets.
const MAX_ARTICLE_CHARS = 120000;

// A single marker call under-marks a LONG passage: the model emphasizes the
// opening and leaves the rest plain, so a big article yields a card with only a
// few underlined/highlighted sentences (all that context, unused). We split a
// long passage into contiguous sections and mark each one, so emphasis is dense
// throughout. A passage at/under one section's budget stays a SINGLE call —
// byte-for-byte the old behavior, so normal-length cards never change.
const SECTION_TARGET_WORDS = 900; // ~a screen of prose — the model marks it densely
const MAX_MARKER_SECTIONS = 8; // bound the AI calls (latency + free-tier budget) per cut

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
 * Split a passage's paragraphs into contiguous sections of ~targetWords each
 * (never splitting a paragraph), capped at maxSections. Used to mark a long
 * passage in pieces so emphasis is distributed across the WHOLE card, not just
 * its opening. Every paragraph appears in exactly one section, in order, so the
 * sections rejoin into the original passage. A passage at/under one section's
 * budget returns a SINGLE section — the unchanged single-call path.
 */
export function splitIntoSections(
  paragraphs: string[],
  targetWords: number,
  maxSections: number,
): string[] {
  if (paragraphs.length === 0) return [];
  const counts = paragraphs.map(countWords);
  const total = counts.reduce((a, b) => a + b, 0);
  // Grow the per-section budget so the number of sections can't exceed the cap
  // (a very long "Entire Article" passage gets fewer, larger sections).
  const budget = Math.max(targetWords, Math.ceil(total / maxSections));

  const sections: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    current.push(paragraphs[i]);
    words += counts[i];
    // Close the section at the budget — but stop opening new sections once we're
    // one short of the cap, so the final section absorbs any remaining paragraphs.
    if (words >= budget && sections.length < maxSections - 1) {
      sections.push(current.join("\n\n"));
      current = [];
      words = 0;
    }
  }
  if (current.length > 0) sections.push(current.join("\n\n"));
  return sections;
}

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

/**
 * Append the real source URL to the bracketed cite, deterministically. The AI is
 * never given the URL, so this is the ONLY place a link enters the cite — it can
 * never be hallucinated. No-ops when there's no URL or it's already present.
 */
export function appendSourceUrl(citeDetails: string, url?: string): string {
  const cite = citeDetails.trim();
  if (!url) return cite;
  if (cite.includes(url)) return cite;
  const sep = /[.,;]$/.test(cite) ? " " : ", ";
  return `${cite}${sep}${url}`;
}

const selectorSchema = z.union([
  z.object({ startIndex: z.number().int().min(0), endIndex: z.number().int().min(0) }),
  z.object({ error: z.literal("no_warrant") }),
]);

const SELECTOR_SYSTEM = `You are the passage selector inside a debate card-cutting tool (Lincoln-Douglas). You receive a claim and an article split into numbered paragraphs. Pick the CONTIGUOUS run of paragraphs that best supports the claim at the requested card length.

Selection question: "If a debater could only read one section of this article, which section best proves this claim — TOGETHER with the reasoning and warrants that support it?" Pick the section that contains the claim's support AND the surrounding logic that explains WHY it is true (mechanisms, key premises, evidence, implications) — a complete, self-contained argument, not just the single sentence that matches the claim. Optimize for the strongest WARRANT — the causal reasoning proving the claim — not the first or longest paragraph.

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
  highlights: z.array(z.string()).max(400),
  // Optional so an older/underspecified model response still parses — a card
  // with no bolds is valid, just less emphasized.
  bolds: z.array(z.string()).max(200).optional().default([]),
});

const MARKER_SYSTEM = `You are the emphasis marker inside a debate card-cutting tool (Lincoln-Douglas). You receive a claim and a passage extracted VERBATIM from an article. You do NOT rewrite anything — you return metadata that the app applies to the original text.

Return ONLY JSON:
{"tag": "...", "cite": "...", "citeDetails": "...", "underlines": ["...", ...], "highlights": ["...", ...], "bolds": ["...", ...]}

There are THREE layers of emphasis, exactly like a hand-cut debate card:
  1. plain text — context that is kept but NOT read aloud (most of the passage stays plain).
  2. underline — the sentences/clauses the debater READS ALOUD.
  3. highlight — the key warrant phrases INSIDE the underlined text that the debater's voice STRESSES (coherent phrases, never lone keywords).

Work through the passage from beginning to end so emphasis is distributed throughout, not clustered at the top.

- underlines: the read-aloud text — full clauses/sentences COPIED EXACTLY from the passage. Underline the COMPLETE chain of reasoning that supports the claim, NOT only the sentences that restate it. Think like a skilled debater building a fully-warranted card, and underline a sentence if it does ANY of these for the claim:
    • states or restates the claim;
    • gives the WHY or HOW — the causal mechanism, logic, or warrant behind it;
    • establishes a definition, premise, or assumption the argument depends on;
    • supplies supporting evidence, data, an authority, or a concrete example;
    • draws out an implication, consequence, or stake that follows from it.
  A sentence does NOT need to contain the claim's exact words to be worth underlining — capture the surrounding reasoning that a judge needs to understand not just WHAT is claimed but WHY it is true and what follows.
  BALANCE — avoid BOTH failure modes (this is critical): underline the READ-ALOUD CORE (the claim plus the load-bearing warrant, mechanism, evidence, and impact sentences a debater actually reads in-round) and leave the rest PLAIN (pure setup, scene-setting, throat-clearing transitions, tangents, citations, asides, and repetition).
    (1) TOO MUCH: if you find yourself underlining nearly EVERY sentence — or the whole passage — you are underlining too much. Pull back to the sentences that genuinely carry the argument and leave the connective/background text plain. A card with everything underlined is as useless as one with nothing underlined.
    (2) TOO LITTLE: if a judge could NOT follow WHY the claim is true from the underlined sentences alone, you are underlining too little — add the warrant/mechanism sentences that prove it.
  The right amount SCALES with passage length: a longer passage keeps substantial plain context between the read-aloud sentences (you are selecting the spine of the argument, not shading the page). A debater reading only the underlined text should hear a complete, self-contained, well-warranted argument — not the entire article, and not a bare list of claim restatements. Each string stays within one paragraph.

- highlights: the load-bearing warrant phrases WITHIN the underlined sentences — the words the debater stresses. Follow these rules strictly:
  • A highlight is a COHERENT, self-contained phrase that still makes sense read on its own — usually a short clause of about 3 to 10 words that keeps the key term TOGETHER with the words that state the point about it (subject + what is said about it). Example shape: "is the single strongest predictor of support", not "predictor".
  • NEVER highlight a bare topic word or buzzword by itself ("nationalism", "reality", "emissions", "one", "truth"). If the crucial term is a single word, extend the highlight to include the surrounding words that give it meaning. A highlight that is just a keyword with no context is WRONG.
  • Highlight each idea ONCE. NEVER highlight the same word or phrase more than once, even if the term recurs many times — choose the ONE sentence where it most clearly proves the claim and highlight it only there. Repeating the same buzzword is WRONG.
  • Copy each highlight EXACTLY from inside an underlined sentence. Read in sequence, the highlights should form a coherent compressed version of the argument — not a scatter of disconnected words.
  • Capture the WARRANT, not just the claim: make sure the highlighted phrases include the load-bearing reasoning — the WHY/HOW (mechanism, causal link), the key evidence, and the impact/stakes — so that reading only the highlights conveys why the claim is TRUE, not merely that it was asserted. Prefer meaningful, self-contained clauses over many disconnected fragments (a dense underlined sentence usually has ONE or TWO highlight-worthy clauses, not five) — but do not under-highlight to the point that the warrant is left unstressed.

Worked example (match this style exactly):
  Claim: "Christian nationalism drives support for the candidate."
  Underlined sentence: "Survey data show that Christian nationalism is the single strongest predictor of support, outweighing income, education, and party affiliation."
  GOOD -> highlights: ["Christian nationalism is the single strongest predictor of support", "outweighing income, education, and party affiliation"]
  BAD  -> highlights: ["Christian nationalism", "Christian nationalism", "predictor", "support"]   (lone, repeated, out-of-context buzzwords — NEVER do this)

- Prioritize by the claim AND its warrants: highlight the phrases that most directly state WHY or HOW the claim is true — the load-bearing reasoning, mechanisms, and consequences — not only phrases that echo the claim's keywords. Because you are now underlining the full reasoning chain, spread highlights across that reasoning (the warrant and implication sentences too), not just the sentences that restate the claim.

- bolds: a SEPARATE, much smaller layer marking the MOST IMPORTANT context inside the underlined text. Bold is not a ranking of your highlights — it is its own judgment about what a reader's eye must land on. Rules:
  • ONLY text that is already underlined may be bolded. NEVER bold text that is not underlined — that is always wrong and gets discarded.
  • MOST OF YOUR BOLDS MUST BE ON UNDERLINED TEXT THAT YOU DID NOT HIGHLIGHT. This is the single most common mistake: do NOT simply repeat your highlight phrases back as bolds. If every bold you return is also a highlight, you have done this WRONG — go back and find the un-highlighted underlined language that carries critical context.
  • What deserves bold in un-highlighted underlined text: the load-bearing qualifier, limitation, scope condition, credential, number, date, or causal connector that a reader must not miss — e.g. "fewer than one in three", "only when the coalition is broad", "the world's largest emitter", "declined by 40% since 2010".
  • A highlight may ALSO be bolded, but only for the strongest one or two phrases in the entire card. Never bold every highlight.
  • Keep bolds SHORT — usually 2 to 8 words, tighter than a highlight. Bold a phrase, never a whole sentence.
  • Do NOT overuse bolding: a typical card has only about 3 to 6 bolds total. If several underlined sections are equally critical, bold each; otherwise bold only the strongest.
  The legal combinations are: underlined only; underlined + highlighted; underlined + bold; underlined + highlighted + bold. Text that is not underlined must never be bolded or highlighted.
  Copy each bold EXACTLY from inside an underlined span; a bold that isn't inside underlined text is discarded.
  Worked example (continuing the sanctions card above):
    Underlined + highlighted: "sanctions achieve their stated political objectives in fewer than one in three cases"
    GOOD -> bolds: ["fewer than one in three cases", "leaving elites insulated", "most effective when the demand is modest"]  (a mix: one inside a highlight, the rest from underlined text that was NOT highlighted)
    BAD  -> bolds: [every phrase you already listed in highlights]   (bold adds nothing — NEVER do this)

- tag: a punchy 1-2 sentence statement of what the evidence proves, phrased from the user's claim (this is YOUR wording). Mark 1-3 key phrases with __underline__ markers.
- cite: the HUMAN author's last name + 2-digit year, no apostrophe (e.g. "Rodrigues 16"). Multiple authors: "FirstAuthorLastName et al. YY". Only when NO human author is stated anywhere: publication name + YY. See "Finding the author".
- citeDetails: full cite content WITHOUT brackets: author (+ qualifications if known), "Article Title." Publication, date. Do NOT include a URL — the app appends the real link itself.

Finding the author (name the PERSON who wrote it, never the website):
- Use the provided metadata author when it is a person's name.
- Treat the metadata author as NOT a real byline if it is an organization or matches/contains the publication (e.g. author "Reuters" with publication "Reuters", or "BBC News"). In that case ignore it and search the CITE CONTEXT block for a human byline ("By Jane Smith", "Article written by: Jane Smith", usually at the very top or bottom) and use that name.
- NEVER invent, guess, or infer an author from the topic. Only if NO human author is stated anywhere (metadata or cite context) may you cite by the publication (e.g. "Reuters 25").
- Same rule for dates and credentials: use only what the metadata or cite context actually states.

Strings that don't match the passage exactly get silently dropped, so copy underlines/highlights/bolds with care — including punctuation and capitalization.`;

function buildMarkerPrompt(claim: string, article: ExtractedArticle, passage: string): string {
  // Bylines usually live at the very top or bottom of the article, which the
  // selected passage may exclude — give the model the head + tail for the cite.
  const head = article.text.slice(0, 800);
  const tail = article.text.length > 1300 ? article.text.slice(-500) : "";
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

type MarkerData = z.infer<typeof markerSchema>;

/**
 * One marker call over a passage (or one section of it): the quality-critical
 * step. A stronger model picks coherent in-context warrant phrases instead of
 * disconnected buzzwords. It fails FAST on the premium model (retries: 0) — that
 * model gets "high demand" 503s — and drops straight to the reliable default
 * model rather than burning ~15s retrying. maxOutputTokens is large because dense
 * emphasis means many substrings (avoid truncation). Throws on total failure or
 * unparseable output.
 */
async function markPassageSection(
  claim: string,
  article: ExtractedArticle,
  section: string,
): Promise<MarkerData> {
  const prompt = buildMarkerPrompt(claim, article, section);
  let raw: unknown;
  try {
    raw = await generateJson({
      system: MARKER_SYSTEM,
      prompt,
      model: GEMINI_MARKER_MODEL,
      maxOutputTokens: 40000,
      retries: GEMINI_MARKER_MODEL !== GEMINI_MODEL ? 0 : undefined,
    });
  } catch (err) {
    if (err instanceof RateLimitedError && GEMINI_MARKER_MODEL !== GEMINI_MODEL) {
      console.warn("cardCutter: marker model busy; falling back to the default model");
      raw = await generateJson({
        system: MARKER_SYSTEM,
        prompt,
        model: GEMINI_MODEL,
        maxOutputTokens: 40000,
      });
    } else {
      throw err;
    }
  }
  const parsed = markerSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("cardCutter: unparseable marker output");
    throw new Error("Card cutting finished but returned an unreadable result. Please try again.");
  }
  return parsed.data;
}

/** Resolve the cut source into clean article text + metadata. */
async function resolveSource(req: CutRequest): Promise<ExtractedArticle> {
  const fromProvidedText = (): ExtractedArticle => ({
    title: req.source.title ?? "",
    author: req.source.author ?? "",
    publication: req.source.publication ?? "",
    date: req.source.date ?? "",
    text: (req.source.text ?? "").trim(),
  });

  if (req.source.url) {
    try {
      const extracted = await extractArticleCached(req.source.url);
      // User/search-supplied metadata wins over what the page scraper guessed.
      return {
        ...extracted,
        title: req.source.title || extracted.title,
        author: req.source.author || extracted.author,
        publication: req.source.publication || extracted.publication,
        date: req.source.date || extracted.date,
      };
    } catch (err) {
      // The URL couldn't be read (paywalled DOI/publisher page, JS-only, PDF).
      // Search results ship the real abstract as a fallback — cut from that
      // rather than failing. It's still verbatim author wording, just shorter.
      const fallback = fromProvidedText();
      if (err instanceof ArticleUnreadableError && fallback.text.length >= 200) {
        console.warn("cardCutter: URL unreadable; cutting from provided abstract text");
        return fallback;
      }
      throw err;
    }
  }
  return fromProvidedText();
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

// Re-cutting the same source at the same length/claim (common while iterating)
// reuses the card for 30 min — zero AI cost. Shared across instances/users via
// Redis when configured (in-memory otherwise).
const cutCache = createSharedCache<Card>({ ttlMs: 30 * 60 * 1000, namespace: "cut", maxLocal: 30 });

/** Stable, compact key for a cut request (hashes long pasted text). */
function cutCacheKey(req: CutRequest): string {
  const sourceKey = req.source.url ?? `text:${djb2(req.source.text ?? "")}`;
  return `${sourceKey}|${req.cardLength}|${req.claim.trim().toLowerCase()}`;
}

/** Tiny non-crypto string hash — just to key the cache on pasted text. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Cut a debate-ready card from a URL or pasted text.
 * The body is real article text with emphasis applied on top — the AI cannot
 * alter the wording because it never produces the wording.
 */
export async function cutCard(req: CutRequest): Promise<Card> {
  return cutCache.wrap(cutCacheKey(req), () => runCut(req));
}

async function runCut(req: CutRequest): Promise<Card> {
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

  // Mark the passage in sections so emphasis reaches the WHOLE card, not just its
  // opening. A normal-length passage is a single section → one marker call,
  // identical to before. A long passage (big article) is split so every part is
  // marked densely — the fix for "huge article, only a couple highlighted lines".
  const sections = splitIntoSections(
    splitParagraphs(passage),
    SECTION_TARGET_WORDS,
    MAX_MARKER_SECTIONS,
  );

  let head: MarkerData;
  const underlines: string[] = [];
  const highlights: string[] = [];
  const bolds: string[] = [];

  if (sections.length <= 1) {
    head = await markPassageSection(req.claim, article, sections[0] ?? passage);
    underlines.push(...head.underlines);
    bolds.push(...head.bolds);
    highlights.push(...head.highlights);
  } else {
    // Section 0 owns the tag/cite (it holds the article's opening) and MUST
    // succeed. The rest are best-effort in parallel: one busy/failed section
    // shouldn't sink the whole card — it just contributes no marks (that region
    // stays plain) instead of throwing. applyEmphasis dedupes highlights across
    // sections and marks every underline occurrence, so merging is safe.
    const marked = await Promise.all(
      sections.map((sec, i) =>
        markPassageSection(req.claim, article, sec).catch((err: unknown) => {
          if (i === 0) throw err;
          console.warn(`cardCutter: section ${i} marking failed; leaving it plain`, String(err));
          return null;
        }),
      ),
    );
    const first = marked[0];
    if (!first) {
      throw new Error("Card cutting couldn't mark the opening section. Please try again.");
    }
    head = first;
    for (const m of marked) {
      if (!m) continue;
      underlines.push(...m.underlines);
      bolds.push(...m.bolds);
      highlights.push(...m.highlights);
    }
  }

  const { body, missed, applied } = applyEmphasis(passage, underlines, highlights, bolds);
  if (missed > 0) {
    console.warn(`cardCutter: ${missed} emphasis substrings didn't match and were skipped (${applied} applied)`);
  }

  return {
    // The tag is the one place the AI supplies markup (`__key phrase__`);
    // convert it to internal delimiters. The body already carries them.
    tag: tagMarkupToDelimiters(head.tag),
    cite: head.cite,
    // Add the real link ourselves — never from the AI, so it can't be invented.
    citeDetails: appendSourceUrl(head.citeDetails, req.source.url),
    body,
  };
}
