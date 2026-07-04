import { z } from "zod";
import { generateJson } from "@/lib/gemini";
import { verifyVerbatim } from "@/lib/verbatim";
import {
  ArticleUnreadableError,
  extractArticleFromUrl,
  type ExtractedArticle,
} from "@/services/articleExtract";
import type { Card, CutRequest } from "@/types";

export { ArticleUnreadableError };

/** Honest failure — nothing in the article strongly proves the claim. */
export class NoWarrantFoundError extends Error {
  constructor() {
    super("Unable to identify a sufficiently strong argumentative passage.");
    this.name = "NoWarrantFoundError";
  }
}

/** Honest failure — the AI's output wasn't verbatim, so the card was rejected. */
export class VerbatimCheckFailedError extends Error {
  constructor() {
    super(
      "The cut didn't pass the verbatim check (the card text must match the article exactly), so it was rejected. Please try again.",
    );
    this.name = "VerbatimCheckFailedError";
  }
}

const cardSchema = z.object({
  tag: z.string().min(1),
  cite: z.string().min(1),
  citeDetails: z.string().min(1),
  body: z.string().min(1),
});

const cutterOutputSchema = z.union([
  z.object({ card: cardSchema }),
  z.object({ error: z.literal("no_warrant") }),
]);

// Keeps prompts inside free-tier token budgets; plenty for almost any article.
const MAX_ARTICLE_CHARS = 60000;

// Formatting spec replicated from the user's sample card ("Rodrigues 16").
const CUTTER_SYSTEM_PROMPT = `You are the Card Cutter inside Line by Line Lab, a tool that cuts debate-ready evidence ("cards") for competitive debate (Lincoln-Douglas). You receive the full text of ONE article and produce ONE card supporting the user's claim.

## The iron rules (violating these destroys the product)
1. You EXTRACT. You never summarize, never paraphrase, never synthesize. Every word in the card body must appear VERBATIM in the provided article text, in the original order. The body is checked programmatically against the article — any altered wording gets the card rejected.
2. Text may only be OMITTED between passages, never altered within them. Mark omissions between passages with [...] on its own. Do not omit words inside a sentence.
3. Never invent citations, quotes, dates, or credentials. Cite only what is known.
4. If nothing in the article strongly supports the claim, return the error output. Never force a weak card.

## Card selection
Ask: "If a debater could only read one section of this article, which section best proves this claim?" Optimize for the strongest WARRANT — the causal reasoning that proves the claim — not the first paragraph, the longest paragraph, or the most famous quote. Keep enough surrounding context that the evidence reads fairly.

## Card length
- Short: the single strongest warrant (roughly one paragraph of source text).
- Medium: the strongest warrant plus its supporting explanation (1-3 paragraphs).
- Long: the complete chain of reasoning (multiple paragraphs).
- Entire Article: the whole article body (omit only navigation junk/ads if present).

## Formatting (replicate the user's sample card exactly)
Three emphasis layers in the body, marked with this syntax:
- ==text== : HIGHLIGHTED key warrants — the punchiest words a debater reads with emphasis. The highlighted text alone must read as a coherent, grammatical argument. Highlight selectively (roughly 10-25% of the body).
- __text__ : UNDERLINED read-aloud text — the full sentences/clauses read in-round. Includes the highlighted parts' surroundings.
- plain text : kept-but-unread context (rendered small). Paragraphs that are context-only stay entirely plain.
Markers must not span paragraph breaks — open and close them within the same paragraph.

Fields:
- tag: a punchy 1-2 sentence statement of what the evidence proves, phrased from the user's claim (this is YOUR wording, not the author's). Mark the key phrases with __underline__.
- cite: AuthorLastName YY — no apostrophe (e.g. "Rodrigues 16"). Multiple authors: "FirstAuthor et al. YY". No known author: publication name + YY.
- citeDetails: the full cite content WITHOUT brackets: author name (+ qualifications if stated in the article), "Article Title." Publication, date, URL if known (e.g.: hrodrigues. "Avidya (Ignorance) | Mahavidya." Mahavidya.ca scholarly study of the Hindu tradition, 26 Apr. 2016, mahavidya.ca/2016/04/26/avidya-ignorance/.)
- body: the verbatim extracted text with the three-layer markup.

## Output format
Return ONLY a JSON object. Exactly one of:
{"card": {"tag": "...", "cite": "...", "citeDetails": "...", "body": "..."}}
{"error": "no_warrant"}`;

function buildCutPrompt(
  req: CutRequest,
  article: ExtractedArticle,
  retryFeedback?: string,
): string {
  const truncated = article.text.length > MAX_ARTICLE_CHARS;
  return [
    `Claim the card must support: ${req.claim}`,
    `Card length: ${req.cardLength}`,
    `Known metadata — title: ${article.title || "unknown"}; author: ${article.author || "unknown"}; publication: ${article.publication || "unknown"}; date: ${article.date || "unknown"}.`,
    retryFeedback ? `\nPREVIOUS ATTEMPT REJECTED: ${retryFeedback}\n` : "",
    truncated ? "(Article truncated for length.)" : "",
    "--- ARTICLE TEXT START ---",
    article.text.slice(0, MAX_ARTICLE_CHARS),
    "--- ARTICLE TEXT END ---",
  ]
    .filter(Boolean)
    .join("\n");
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

/**
 * Cut a debate-ready card from a URL or pasted text. The body is verified
 * verbatim against the source; a non-verbatim cut gets one retry with
 * feedback, then an honest rejection.
 */
export async function cutCard(req: CutRequest): Promise<Card> {
  const article = await resolveSource(req);
  if (article.text.length < 200) {
    throw new ArticleUnreadableError(
      "That article text is too short to cut a card from. Paste the full article body.",
    );
  }

  let retryFeedback: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generateJson({
      system: CUTTER_SYSTEM_PROMPT,
      prompt: buildCutPrompt(req, article, retryFeedback),
      maxOutputTokens: 32768,
    });

    const parsed = cutterOutputSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("cardCutter: unparseable model output");
      retryFeedback = "Your output was not valid JSON in the required shape. Return ONLY the JSON object.";
      continue;
    }

    if ("error" in parsed.data) {
      throw new NoWarrantFoundError();
    }

    // The no-fabrication guarantee: reject any body that isn't verbatim.
    const verdict = verifyVerbatim(parsed.data.card.body, article.text);
    if (verdict.ok) {
      return parsed.data.card;
    }
    console.warn("cardCutter: verbatim check failed on chunk:", verdict.failedChunk);
    retryFeedback = `Your card body did not match the article verbatim. This chunk is not in the article text: "${verdict.failedChunk}". Copy text EXACTLY as it appears — no rewording, no fixing typos, no merging sentences.`;
  }

  throw new VerbatimCheckFailedError();
}
