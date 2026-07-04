import { z } from "zod";
import { generateJson } from "@/lib/gemini";
import {
  searchAcademic,
  type CandidateArticle,
} from "@/services/academicSearch";
import type { Article, SearchParams } from "@/types";

/** Honest failure — no reputable sources exist. Never fabricate one instead. */
export class NoSourcesFoundError extends Error {
  constructor() {
    super("No reputable sources were found matching your criteria.");
    this.name = "NoSourcesFoundError";
  }
}

/**
 * Pipeline: (1) Gemini expands the claim into academic search queries,
 * (2) OpenAlex + Semantic Scholar retrieve REAL papers, (3) Gemini ranks the
 * retrieved candidates for debate usefulness and explains each pick.
 * The AI never supplies an article — it only chooses among database results.
 */

const DEBATE_KNOWLEDGE = `You understand competitive debate (Lincoln-Douglas) natively:
- Evidence functions: Link, Internal Link, Impact, Uniqueness, Solvency, Framework, Theory, K Link, Alternative Solvency.
- The evidence type changes what makes a source useful. A "Link" needs causal connection between actions and outcomes. An "Impact" needs magnitude/probability of harm. "Uniqueness" needs status-quo trend evidence. "Solvency" needs evidence a mechanism works. "Framework" needs normative/philosophical grounding. A "K Link" needs critical-theory engagement with the claim's assumptions.
- Structures: tags, warrants, extensions, overviews. Argument types: disadvantages, counterplans, kritiks, theory, framework. Reasoning: turns, offense, defense, weighing.`;

const EXPANDER_SYSTEM = `${DEBATE_KNOWLEDGE}

You turn a debate claim into search queries for scholarly databases (OpenAlex, Semantic Scholar). Academic papers don't use debate phrasing — translate the claim into the underlying academic and policy concepts, shaped by the evidence type.

Return ONLY JSON: {"queries": ["...", "..."]} — 2 to 3 keyword-style queries (3-8 words each), no boolean operators, each attacking the claim from a different scholarly angle.`;

const expanderSchema = z.object({
  queries: z.array(z.string().min(3)).min(1).max(4),
});

const RANKER_SYSTEM = `${DEBATE_KNOWLEDGE}

You are the ranking stage of a debate evidence search engine. You receive a claim, an evidence type, and a numbered list of REAL articles retrieved from scholarly databases. Your job is to pick the articles a debater should actually read.

Rules:
- Select ONLY from the provided candidates, by their index number. Never invent an article.
- Judge debate usefulness for THIS claim and THIS evidence type from each abstract — not just topical overlap. An article that argues the claim is better than one that merely mentions it.
- Ranking factors in order: relevance to the exact claim, debate usefulness for the evidence type, publication credibility (peer-reviewed journals and university publications highest), author expertise, recency.
- Drop candidates that are off-topic, that argue AGAINST the claim (unless nothing supports it — then return none), or that are too weak to cut.
- explanation: 1-2 concrete sentences on exactly what claim the article supports and why it's useful for this evidence type.
- credibilityScore: 0-100 from venue quality, citation count, and author expertise.
- Pick 3-6 when good candidates exist. If NONE genuinely support the claim, return {"selections": []}.

Return ONLY JSON: {"selections": [{"index": 2, "explanation": "...", "credibilityScore": 87}, ...]} ordered best-first.`;

const rankerSchema = z.object({
  selections: z.array(
    z.object({
      index: z.number().int().min(0),
      explanation: z.string().min(1),
      credibilityScore: z.number().min(0).max(100),
    }),
  ),
});

function candidateToPromptLine(c: CandidateArticle, index: number): string {
  const abstract = c.abstract.length > 700 ? `${c.abstract.slice(0, 700)}…` : c.abstract;
  return [
    `[${index}] ${c.title}`,
    `  Authors: ${c.authors.slice(0, 4).join(", ") || "unknown"}`,
    `  Venue: ${c.venue || "unknown"} | Date: ${c.date || "unknown"} | Citations: ${c.citationCount}`,
    `  Abstract: ${abstract || "(none)"}`,
  ].join("\n");
}

function candidateToArticle(
  c: CandidateArticle,
  explanation: string,
  credibilityScore: number,
): Article {
  return {
    title: c.title,
    author: c.authors.length > 1 ? `${c.authors[0]} et al.` : c.authors[0] ?? c.venue,
    url: c.url,
    publication: c.venue || c.source,
    date: c.date || "unknown",
    explanation,
    credibilityScore,
  };
}

export async function findArticles(params: SearchParams): Promise<Article[]> {
  // 1. Debate-aware query expansion (Gemini, free tier).
  const expansionRaw = await generateJson({
    system: EXPANDER_SYSTEM,
    prompt: `Evidence type: ${params.evidenceType}\nClaim: ${params.claim}`,
    maxOutputTokens: 1024,
  });
  const expansion = expanderSchema.safeParse(expansionRaw);
  // If expansion fails, fall back to the raw claim as the query.
  const queries = expansion.success ? expansion.data.queries : [params.claim];

  // 2. Retrieve real articles from the free scholarly databases.
  const candidates = await searchAcademic(queries, params.publicationAge);
  if (candidates.length === 0) {
    throw new NoSourcesFoundError();
  }

  // 3. Debate-aware ranking over ONLY the retrieved candidates.
  const shortlist = candidates.slice(0, 24);
  const rankingPrompt = [
    `Evidence type: ${params.evidenceType}`,
    `Claim to support: ${params.claim}`,
    params.sourceType && params.sourceType !== "Any"
      ? `Preferred source type: ${params.sourceType} (prioritize, don't exclude)`
      : "",
    "",
    "Candidates:",
    ...shortlist.map(candidateToPromptLine),
  ]
    .filter(Boolean)
    .join("\n");

  const rankingRaw = await generateJson({
    system: RANKER_SYSTEM,
    prompt: rankingPrompt,
    maxOutputTokens: 4096,
  });
  const ranking = rankerSchema.safeParse(rankingRaw);
  if (!ranking.success) {
    console.error("articleFinder: unparseable ranking output", ranking.error.message);
    throw new Error("The search completed but returned an unreadable result. Please try again.");
  }

  const articles = ranking.data.selections
    .filter((s) => s.index < shortlist.length)
    .map((s) => candidateToArticle(shortlist[s.index], s.explanation, s.credibilityScore));

  if (articles.length === 0) {
    throw new NoSourcesFoundError();
  }
  return articles;
}
