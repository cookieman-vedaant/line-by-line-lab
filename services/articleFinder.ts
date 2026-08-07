import { z } from "zod";
import { RateLimitedError, generateJson } from "@/lib/gemini";
import { createSharedCache } from "@/lib/sharedCache";
import { filterReputable } from "@/lib/sourceFilter";
import {
  dedupeCandidates,
  searchAcademic,
  type CandidateArticle,
} from "@/services/academicSearch";
import { verifyAccessible } from "@/services/articleExtract";
import { searchWeb } from "@/services/webSearch";
import type { Article, SearchParams, SearchStage } from "@/types";

/**
 * Notified as each pipeline phase begins. Optional everywhere: a caller that
 * doesn't care (tests, the Coach) passes nothing and the pipeline is unchanged.
 */
export type StageReporter = (stage: SearchStage) => void;

// How many top-ranked candidates to fetch-verify, and how many to return.
const VERIFY_LIMIT = 10;
const RETURN_LIMIT = 8;
// Cap open-web hits so they broaden the pool without crowding out the academic
// depth a debater needs for warrants and Ks.
const WEB_LIMIT = 12;

/**
 * Fetch-check the top candidates in parallel and mark which yield real, readable
 * full text (not paywalled/abstract-only). Return accessible ones FIRST — badged
 * so the debater knows they can open and cut them — then top up with the
 * remaining ranked candidates so the list is never near-empty. Every article is
 * labeled `accessible` true/false so the UI and Coach can prefer the openable
 * ones while still surfacing the full ranked set (the cutter's abstract fallback
 * still lets a debater cut from a non-accessible pick).
 */
async function verifyAndFilter(articles: Article[]): Promise<Article[]> {
  const head = articles.slice(0, VERIFY_LIMIT);
  const checked = await Promise.all(
    head.map(async (a) => ({ article: a, ok: (await verifyAccessible(a.url)).ok })),
  );
  const accessible = checked
    .filter((c) => c.ok)
    .map((c) => ({ ...c.article, accessible: true }));
  const rest = checked
    .filter((c) => !c.ok)
    .map((c) => ({ ...c.article, accessible: false }));

  // Accessible first, then ranked-but-unverified to fill out the list.
  return [...accessible, ...rest].slice(0, RETURN_LIMIT);
}

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

// Debate-specific jargon that hurts scholarly/web search — stripped to make a
// cleaner second query. The raw claim is always query #1.
const DEBATE_JARGON =
  /\b(the aff|the neg|aff|neg|plan|cp|counterplan|the resolution|resolved|solvency|uniqueness|the link|impact card|turn|perm|the k|kritik|framework|fiat|status quo|squo)\b/gi;

/**
 * Build search queries WITHOUT an AI call: the raw claim, plus a jargon-stripped
 * variant when it differs. This replaces the old Gemini query-expander — halving
 * a search's AI calls (2→1) so the quota is spent on the quality-critical
 * ranking step. OpenAlex / Semantic Scholar / the web engine all match natural
 * language, so the raw claim is a fine primary query.
 */
export function heuristicQueries(claim: string): string[] {
  const raw = claim.trim();
  const cleaned = raw
    .replace(DEBATE_JARGON, " ")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const queries = [raw];
  if (cleaned && cleaned.toLowerCase() !== raw.toLowerCase() && cleaned.split(" ").length >= 3) {
    queries.push(cleaned);
  }
  return queries;
}

const RANKER_SYSTEM = `${DEBATE_KNOWLEDGE}

You are the ranking stage of a debate evidence search engine. You receive a claim, an evidence type, and a numbered list of REAL articles retrieved from scholarly databases AND the open web (reputable news, think tanks, government and organization reports). Your job is to pick the articles a debater should actually read.

Rules:
- Select ONLY from the provided candidates, by their index number. Never invent an article.
- Judge debate usefulness for THIS claim and THIS evidence type from each abstract/snippet — not just topical overlap. An article that argues the claim is better than one that merely mentions it.
- Both scholarly and reputable web sources are valid evidence. Peer-reviewed journals and university publications carry the most authority for deep warrants and Ks; reputable news, think tanks (e.g. Brookings, RAND, CFR), and government/organization reports are strong for uniqueness, recency, and real-world impacts. Judge each source's credibility on its merits — don't reflexively rank all academic above all web.
- Ranking factors in order: relevance to the exact claim, debate usefulness for the evidence type, source credibility, author/institution expertise, recency.
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
// Shared across instances/users via Redis when configured (in-memory otherwise).
const searchCache = createSharedCache<Article[]>({
  ttlMs: 30 * 60 * 1000,
  namespace: "search",
});

function searchCacheKey(p: SearchParams): string {
  return JSON.stringify([
    p.evidenceType,
    p.claim.trim().toLowerCase(),
    p.sourceType ?? "Any",
    p.publicationAge ?? "Any",
  ]);
}

/**
 * `onStage` fires only when the search actually runs. A cache hit skips the
 * pipeline entirely and reports nothing — which is the honest signal, since
 * there is no work in progress to describe.
 */
export async function findArticles(
  params: SearchParams,
  clientKey?: string,
  onStage?: StageReporter,
): Promise<Article[]> {
  return searchCache.wrap(searchCacheKey(params), () => runSearch(params, clientKey, onStage));
}

async function runSearch(
  params: SearchParams,
  clientKey?: string,
  onStage?: StageReporter,
): Promise<Article[]> {
  // 1. Build search queries with NO AI call (see heuristicQueries).
  const queries = heuristicQueries(params.claim);

  // 2. Retrieve real articles from BOTH the open web (Brave) and the free
  //    scholarly databases, in parallel. Web brings news/think-tank breadth;
  //    academic brings depth. Merge, drop non-citable domains (reddit, wikipedia,
  //    social, etc.), then dedupe. Web is capped so it can't crowd out academic
  //    depth. Either source failing degrades gracefully — as long as one returns
  //    something, the search still works.
  onStage?.("retrieve");
  const [webHits, academicHits] = await Promise.all([
    searchWeb(queries, clientKey),
    searchAcademic(queries, params.publicationAge),
  ]);
  const candidates = filterReputable(
    dedupeCandidates([...webHits.slice(0, WEB_LIMIT), ...academicHits]),
  );
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

  onStage?.("rank");
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
      onStage?.("verify");
      return verifyAndFilter(heuristicRanking(shortlist));
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

  // Only surface sources the debater can actually open and cut from.
  onStage?.("verify");
  return verifyAndFilter(articles);
}
