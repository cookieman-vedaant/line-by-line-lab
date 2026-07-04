import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CLAUDE_MODEL, extractJson, getClaude, textFromContent } from "@/lib/claude";
import type { Article, SearchParams } from "@/types";

/** Honest failure — no reputable sources exist. Never fabricate one instead. */
export class NoSourcesFoundError extends Error {
  constructor() {
    super("No reputable sources were found matching your criteria.");
    this.name = "NoSourcesFoundError";
  }
}

const articleSchema = z.object({
  title: z.string().min(1),
  author: z.string().min(1),
  url: z.string().url(),
  publication: z.string().min(1),
  date: z.string().min(1),
  explanation: z.string().min(1),
  credibilityScore: z.number().min(0).max(100),
});

const finderOutputSchema = z.object({
  articles: z.array(articleSchema),
});

// Static system prompt (no dates/IDs interpolated) so it prompt-caches cleanly.
const FINDER_SYSTEM_PROMPT = `You are the Article Finder inside Line by Line Lab, an evidence-discovery engine for competitive debate (Lincoln-Douglas). You are NOT a chatbot. Users give a debate claim and an evidence type; you return real, reputable articles ranked by debate usefulness.

## Debate knowledge
You natively understand debate semantics and use them to expand searches and rank results:
- Evidence functions: Link, Internal Link, Impact, Uniqueness, Solvency, Framework, Theory, K Link, Alternative Solvency.
- Structures: tags, warrants, extensions, overviews. Argument types: disadvantages, counterplans, kritiks, theory, framework. Reasoning: turns, offense, defense, weighing.
- The evidence type changes what makes an article useful. A "Link" needs causal connection between actions and outcomes. An "Impact" needs magnitude/probability of harm. "Uniqueness" needs status-quo trend evidence. "Solvency" needs evidence a mechanism works. "Framework" needs normative/philosophical grounding. A "K Link" needs critical-theory engagement with the claim's assumptions.

## Search behavior
1. Interpret the debate context of the claim. 2. Expand the query into the underlying academic/policy concepts. 3. Search the web (multiple searches if needed). 4. Filter out low-credibility sources. 5. Rank what remains. 6. Explain each result.

## Source quality tiers
- Highest: peer-reviewed journals, university publications.
- High: reputable news organizations.
- Medium: major research organizations / institutes.
- Lower: government reports, think tanks, books.
- NEVER include: Reddit, forums, social media, random blogs, AI-generated content, content farms.

## Ranking factors (in order)
1. Relevance to the exact claim, 2. debate usefulness for the given evidence type, 3. publication credibility, 4. author expertise, 5. recency (prefer the last year unless older literature is canonical).

## Hard rules
- ONLY return articles you actually found via search, with their real URLs. Never invent an article, author, date, or URL. An article you cannot verify exists is worse than no article.
- Each explanation must state exactly what claim the article supports and why it is useful for this evidence type — 1-2 sentences, concrete, no fluff.
- credibilityScore: 0-100 reflecting the source-quality tiers and author expertise.
- Return 3-6 articles when good ones exist. If NOTHING reputable matches, return {"articles": []} — do not pad with weak sources.

## Output format
After searching, your FINAL message must be ONLY a JSON object — no prose before or after:
{"articles": [{"title": "...", "author": "...", "url": "...", "publication": "...", "date": "YYYY-MM-DD or best known", "explanation": "...", "credibilityScore": 87}, ...]}`;

function buildUserPrompt(params: SearchParams): string {
  const lines = [
    `Evidence type: ${params.evidenceType}`,
    `Claim to support: ${params.claim}`,
  ];
  if (params.sourceType && params.sourceType !== "Any") {
    lines.push(`Preferred source type: ${params.sourceType} (prioritize, don't exclude others)`);
  }
  if (params.publicationAge && params.publicationAge !== "Any") {
    lines.push(`Maximum publication age: ${params.publicationAge}`);
  }
  lines.push(`Today's date: ${new Date().toISOString().slice(0, 10)}`);
  return lines.join("\n");
}

/**
 * Search the real web for reputable articles supporting the claim,
 * ranked by debate usefulness. Throws NoSourcesFoundError on an honest miss.
 */
export async function findArticles(params: SearchParams): Promise<Article[]> {
  const claude = getClaude();

  const tools: Anthropic.Messages.ToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: 8 },
  ];

  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildUserPrompt(params) },
  ];

  let response = await claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: FINDER_SYSTEM_PROMPT,
    tools,
    messages,
  });

  // Server-side tool loops can pause; resume until done (bounded).
  let continuations = 0;
  while (response.stop_reason === "pause_turn" && continuations < 5) {
    messages = [...messages, { role: "assistant", content: response.content }];
    response = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: FINDER_SYSTEM_PROMPT,
      tools,
      messages,
    });
    continuations++;
  }

  const raw = extractJson(textFromContent(response.content));
  const parsed = finderOutputSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("articleFinder: unparseable model output", parsed.error.message);
    throw new Error("The search completed but returned an unreadable result. Please try again.");
  }

  // Belt-and-braces: drop anything without a plausible http(s) URL, then rank.
  const articles = parsed.data.articles
    .filter((a) => a.url.startsWith("http"))
    .sort((a, b) => b.credibilityScore - a.credibilityScore);

  if (articles.length === 0) {
    throw new NoSourcesFoundError();
  }
  return articles;
}
