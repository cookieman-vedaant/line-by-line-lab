import { z } from "zod";
import { TtlCache } from "@/lib/cache";
import { RateLimitedError, generateJson } from "@/lib/gemini";
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
- Drop candidates that are clearly off-topic or that argue AGAINST the claim (unless nothing supports it — then return none).
- ERR TOWARD INCLUSION: a debater can skim a marginal article, but can't read one you hid. Include partial or indirect support and note the limits in the explanation.
- explanation: 1-2 concrete sentences on exactly what claim the article supports and why it's useful for this evidence type.
- credibilityScore: 0-100 from venue quality, citation count, and author expertise.
- Pick 5-8 whenever plausible candidates exist (fewer only if the pool is genuinely thin). If NONE relate to the claim at all, return {"selections": []}.

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
    // Carried so the Card Cutter can fall back to real abstract text when the
    // (often paywalled) article URL can't be fetched.
    abstract: c.abstract,
  };
}

/**
 * Non-AI ranking used when Gemini is rate-limited. Keeps search working on a
 * dead quota by returning REAL articles ordered by objective signals — never
 * fabricating relevance. Honest explanation: fit is unverified.
 */
function heuristicRanking(candidates: CandidateArticle[]): Article[] {
  const score = (c: CandidateArticle): number => {
    const citations = Math.min(40, Math.log10(c.citationCount + 1) * 15);
    const year = Number.parseInt(c.date.slice(0, 4), 10);
    const recency = Number.isFinite(year) ? Math.max(0, year - 2010) : 0;
    const hasVenue = c.venue ? 10 : 0;
    return 50 + citations + Math.min(15, recency) + hasVenue;
  };
  return [...candidates]
    .sort((a, b) => score(b) - score(a))
    .slice(0, 6)
    .map((c) =>
      candidateToArticle(
        c,
        "Auto-ranked while the AI ranker was rate-limited — relevance isn't verified, so skim the abstract to confirm it fits your claim.",
        Math.round(Math.min(90, score(c))),
      ),
    );
}

// Repeat searches (same params) reuse the result for 30 min — zero AI cost.
const searchCache = new TtlCache<Article[]>(30 * 60 * 1000);

function searchCacheKey(p: SearchParams): string {
  return JSON.stringify([
    p.evidenceType,
    p.claim.trim().toLowerCase(),
    p.sourceType ?? "Any",
    p.publicationAge ?? "Any",
  ]);
}

export async function findArticles(params: SearchParams): Promise<Article[]> {
  return searchCache.wrap(searchCacheKey(params), () => runSearch(params));
}

async function runSearch(params: SearchParams): Promise<Article[]> {
  // 1. Debate-aware query expansion (Gemini, free tier). If it's unparseable
  //    OR the quota is hit, fall back to the raw claim — never fail the search
  //    over the (optional) expansion step.
  let queries: string[] = [params.claim];
  try {
    const expansionRaw = await generateJson({
      system: EXPANDER_SYSTEM,
      prompt: `Evidence type: ${params.evidenceType}\nClaim: ${params.claim}`,
      maxOutputTokens: 1024,
    });
    const expansion = expanderSchema.safeParse(expansionRaw);
    if (expansion.success) queries = expansion.data.queries;
  } catch (err) {
    if (!(err instanceof RateLimitedError)) throw err;
    // Quota hit on expansion — proceed with the raw claim as the query.
  }

  // 2. Retrieve real articles from the free scholarly databases.
  const candidates = await searchAcademic(queries, params.publicationAge);
  if (candidates.length === 0) {
    throw new NoSourcesFoundError();
  }

  // 3. Debate-aware ranking over ONLY the retrieved candidates. If the ranker
  //    is rate-limited, degrade to objective heuristic ranking so the user
  //    still gets real articles instead of an error.
  const shortlist = candidates.slice(0, 32);
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

  let rankingRaw: unknown;
  try {
    rankingRaw = await generateJson({
      system: RANKER_SYSTEM,
      prompt: rankingPrompt,
      maxOutputTokens: 4096,
    });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      console.warn("articleFinder: ranker rate-limited; using heuristic ranking");
      return heuristicRanking(shortlist);
    }
    throw err;
  }

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
