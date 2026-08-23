import { z } from "zod";
import { RateLimitedError, generateJson } from "@/lib/gemini";
import { fallbackFor, modelFor } from "@/lib/models";
import type { Tier } from "@/lib/tier";
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

/**
 * Turn the ranker's picks into articles, falling back to heuristic ordering
 * when it gave us nothing usable.
 *
 * The model is ALLOWED to return an empty selection list, and on a narrowly
 * worded claim it regularly does: retrieval hands it forty real articles about
 * the subject, none of which argue that exact proposition, and it reports that
 * none "relate to the claim". Treating that as "no reputable sources exist" told
 * debaters the web was empty while forty retrieved articles sat in the shortlist
 * — and it punished precisely the specific, well-formed claims the tool should
 * reward.
 *
 * An empty ranking is an opinion about ORDER, not evidence about the world. So
 * it degrades exactly as an unparseable ranking already did: same real articles,
 * weaker ordering. `NoSourcesFoundError` now means only what it says — retrieval
 * itself came back empty.
 */
export function articlesFromRanking(
  selections: Array<{ index: number; explanation: string; credibilityScore: number }>,
  shortlist: CandidateArticle[],
): Article[] {
  const picked = selections
    .filter((s) => s.index >= 0 && s.index < shortlist.length)
    .map((s) => candidateToArticle(shortlist[s.index], s.explanation, s.credibilityScore));
  if (picked.length > 0) return picked;
  console.warn(
    `articleFinder: ranker selected none of ${shortlist.length} candidates; using heuristic ranking`,
  );
  return heuristicRanking(shortlist);
}

/**
 * Honest failure — RETRIEVAL found nothing. Never fabricate a source instead,
 * and never report this when candidates were found but not ranked (see
 * articlesFromRanking).
 */
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
- Drop candidates that are clearly off-topic or that argue AGAINST the claim.
- ERR TOWARD INCLUSION: a debater can skim a marginal article, but can't read one you hid. Include partial or indirect support and note the limits in the explanation.
- A SPECIFIC claim is not a reason to return less. Debaters write narrow claims ("manufacturing contracted because credit tightened for small firms"), and the literature is usually broader than the sentence they typed. An article that establishes PART of the claim, the general mechanism behind it, or the same effect in a neighbouring case is real evidence a debater can use — rank it and say in the explanation exactly which part it carries and which part it does not. Do NOT require an article to argue the whole claim word for word.
- explanation: 1-2 concrete sentences on exactly what claim the article supports and why it's useful for this evidence type.
- credibilityScore: 0-100 from venue quality, citation count, and author expertise.
- Pick 5-8 whenever plausible candidates exist (fewer only if the pool is genuinely thin). Return {"selections": []} ONLY when the candidates are about an entirely different subject — not merely because none matches the claim exactly. If they are on-subject but imperfect, rank them.

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
    // Display only, and EMPTY when nobody is credited. It used to fall back to
    // `c.venue`, which put the outlet — for a web hit, the bare hostname — into
    // the author field, from where it flowed into the cite and got printed as
    // the byline. "No author stated" and "the publisher wrote it" are different
    // facts; the cite has to be able to tell them apart.
    author: c.authors.length > 1 ? `${c.authors[0]} et al.` : (c.authors[0] ?? ""),
    url: c.url,
    publication: c.venue || c.source,
    // Empty, not the literal string "unknown" — that used to reach the cite as
    // if it were a date and beat the real one off the page.
    date: c.date || "",
    explanation,
    credibilityScore,
    // Carried so the Card Cutter can fall back to real abstract text when the
    // (often paywalled) article URL can't be fetched.
    abstract: c.abstract,
    // The unmangled people, for the cite (see Article.authors).
    authors: c.authors,
    authorInstitutions: c.authorInstitutions,
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

// Tier is part of the key: free ranks on the lite model and pro/admin on the
// strong one, so their result orderings differ and must not share a cache slot.
function searchCacheKey(p: SearchParams, tier: Tier): string {
  return JSON.stringify([
    tier,
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
  tier: Tier = "free",
): Promise<Article[]> {
  return searchCache.wrap(searchCacheKey(params, tier), () =>
    runSearch(params, clientKey, onStage, tier),
  );
}

async function runSearch(
  params: SearchParams,
  clientKey?: string,
  onStage?: StageReporter,
  tier: Tier = "free",
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
      // Pro/admin rank on the stronger judgement model; free stays on lite — the
      // same model the ranker used before, so free results are unchanged.
      model: modelFor("rank", tier).model,
      // When the strong model is out of quota, rank on the cheap model rather
      // than dropping all the way to heuristic ordering. AI ranking on a weaker
      // model still reads the abstracts; the heuristic below never does, so it's
      // the last resort, not the first.
      fallbackModel: fallbackFor("rank", tier) ?? undefined,
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
    /*
     * Degrade instead of failing. By this point the retrieval step has already
     * found REAL articles; only the model's opinion about their ORDER came back
     * malformed. Throwing discarded a whole good result set over a formatting
     * slip — observed live, where a search that had six usable sources reported
     * "returned an unreadable result" instead.
     *
     * Ordering is the one part of the pipeline with a working non-AI
     * implementation, so this is a genuine degradation and not a guess: the
     * articles and their citations are untouched, only the ranking is weaker.
     */
    console.warn("articleFinder: unparseable ranking output; using heuristic ranking", ranking.error.message);
    onStage?.("verify");
    return verifyAndFilter(heuristicRanking(shortlist));
  }

  const articles = articlesFromRanking(ranking.data.selections, shortlist);

  // Only surface sources the debater can actually open and cut from.
  onStage?.("verify");
  return verifyAndFilter(articles);
}
