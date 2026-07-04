import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CLAUDE_MODEL, extractJson, getClaude, textFromContent } from "@/lib/claude";
import type { Card, CutRequest } from "@/types";

/** Honest failure — the article couldn't be read (paywall, dead link, etc.). */
export class ArticleUnreadableError extends Error {
  constructor(detail?: string) {
    super(
      detail ??
        "This article couldn't be read (it may be paywalled or blocked). Try another article.",
    );
    this.name = "ArticleUnreadableError";
  }
}

/** Honest failure — nothing in the article strongly proves the claim. */
export class NoWarrantFoundError extends Error {
  constructor() {
    super("Unable to identify a sufficiently strong argumentative passage.");
    this.name = "NoWarrantFoundError";
  }
}

const cardSchema = z.object({
  tag: z.string().min(1),
  cite: z.string().min(1),
  citeDetails: z.string().min(1),
  body: z.string().min(1),
});

// The model returns exactly one of these shapes.
const cutterOutputSchema = z.union([
  z.object({ card: cardSchema }),
  z.object({ error: z.enum(["unreadable", "no_warrant"]), detail: z.string().optional() }),
]);

// Static system prompt (no interpolation) so it prompt-caches cleanly.
// Formatting follows standard Verbatim conventions until a sample card is provided.
const CUTTER_SYSTEM_PROMPT = `You are the Card Cutter inside Line by Line Lab, a tool that cuts debate-ready evidence ("cards") for competitive debate (Lincoln-Douglas). You read ONE article and produce ONE card supporting the user's claim.

## The iron rules (violating these destroys the product)
1. You EXTRACT. You never summarize, never paraphrase, never synthesize. Every word in the card body must appear VERBATIM in the article, in the article's original order.
2. Text may only be OMITTED, never altered. Mark each omission with [...] in the body.
3. Never invent citations, quotes, dates, or credentials. If the article doesn't state the author's qualifications, cite what is known.
4. If you cannot read the article, or nothing in it strongly supports the claim, say so via the error output. Never force a weak card.

## Card selection
Ask: "If a debater could only read one section of this article, which section best proves this claim?" Optimize for the strongest WARRANT — the causal reasoning that proves the claim — not the first paragraph, the longest paragraph, or the most famous quote. Preserve enough surrounding context that the evidence reads fairly and coherently in-round.

## Card length rules
- Short: the single strongest warrant only (typically 1-3 sentences of source text).
- Medium: the strongest warrant plus its supporting explanation (typically 1-2 paragraphs).
- Long: the complete chain of reasoning (multiple paragraphs as needed).
- Entire Article: the full article body; apply formatting only (omit ads/navigation junk, never argument text).

## Debate formatting (standard Verbatim conventions)
- tag: a one-line statement of what the evidence proves, phrased from the user's claim. Punchy, argumentative, readable in-round.
- cite: AuthorLastName 'YY (e.g. "Rodríguez '24"). Multiple authors: "FirstAuthor et al. 'YY". No known author: use the publication (e.g. "The Economist '25").
- citeDetails: Full name, qualifications if stated, "Publication, Date, URL".
- body: the verbatim extracted text. Wrap the parts a debater would READ ALOUD — the key warrants — in **double asterisks**. Leave necessary-but-unread context unmarked. Use [...] where text was omitted. The emphasized text alone must read as a coherent, grammatical argument.

## Output format
Your FINAL message must be ONLY a JSON object — no prose before or after. Exactly one of:
{"card": {"tag": "...", "cite": "...", "citeDetails": "...", "body": "..."}}
{"error": "unreadable", "detail": "one short sentence on why"}
{"error": "no_warrant"}`;

function buildUserPrompt(req: CutRequest): string {
  return [
    `Claim the card must support: ${req.claim}`,
    `Card length: ${req.cardLength}`,
    `Article to cut (fetch this URL and read the full text):`,
    req.article.url,
    `Known metadata — title: ${req.article.title}; author: ${req.article.author}; publication: ${req.article.publication}; date: ${req.article.date}.`,
  ].join("\n");
}

/**
 * Read the selected article and cut a debate-ready card.
 * Throws ArticleUnreadableError / NoWarrantFoundError on honest failures.
 */
export async function cutCard(req: CutRequest): Promise<Card> {
  const claude = getClaude();

  const tools: Anthropic.Messages.ToolUnion[] = [
    {
      type: "web_fetch_20260209",
      name: "web_fetch",
      max_uses: 3,
      max_content_tokens: 100000,
    },
  ];

  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildUserPrompt(req) },
  ];

  // Long output possible (Entire Article) — stream to avoid HTTP timeouts.
  let response = await claude.messages
    .stream({
      model: CLAUDE_MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      system: CUTTER_SYSTEM_PROMPT,
      tools,
      messages,
    })
    .finalMessage();

  // Server-side tool loops can pause; resume until done (bounded).
  let continuations = 0;
  while (response.stop_reason === "pause_turn" && continuations < 5) {
    messages = [...messages, { role: "assistant", content: response.content }];
    response = await claude.messages
      .stream({
        model: CLAUDE_MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        system: CUTTER_SYSTEM_PROMPT,
        tools,
        messages,
      })
      .finalMessage();
    continuations++;
  }

  const raw = extractJson(textFromContent(response.content));
  const parsed = cutterOutputSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("cardCutter: unparseable model output", parsed.error.message);
    throw new Error("Card cutting finished but returned an unreadable result. Please try again.");
  }

  if ("error" in parsed.data) {
    if (parsed.data.error === "unreadable") {
      throw new ArticleUnreadableError(
        parsed.data.detail
          ? `This article couldn't be read: ${parsed.data.detail} Try another article.`
          : undefined,
      );
    }
    throw new NoWarrantFoundError();
  }

  return parsed.data.card;
}
