import { z } from "zod";
import { mapWithConcurrency, createLimiter } from "@/lib/concurrency";
import { MissingApiKeyError, RateLimitedError, generateJson } from "@/lib/gemini";
import { fallbackFor, modelFor } from "@/lib/models";
import type { Tier } from "@/lib/tier";
import { createSharedCache } from "@/lib/sharedCache";
import { filterReputable, isBlockedDomain } from "@/lib/sourceFilter";
import {
  dedupeCandidates,
  isFetchableUrl,
  searchAcademicBuckets,
  type CandidateArticle,
} from "@/services/academicSearch";
import { verifyAccessible } from "@/services/articleExtract";
import { rememberSourceMeta } from "@/services/sourceMeta";
import { searchWeb } from "@/services/webSearch";
import type { Article, SearchParams, SearchStage } from "@/types";

/**
 * Notified as each pipeline phase begins. Optional: a caller that doesn't show
 * progress (the Coach, tests) passes nothing.
 *
 * Passing no reporter also marks the caller as NON-INTERACTIVE — a tool call
 * inside a larger request with its own time limit (the Coach runs up to two
 * searches plus a cut inside one 120s request). Such a search gets a shorter
 * budget and skips the optional second "deepen" round. `FindOptions` overrides
 * this either way.
 */
export type StageReporter = (stage: SearchStage) => void;

export interface FindOptions {
  /** Run the second round when full text is thin. Default: only for interactive callers. */
  deepen?: boolean;
  /** Overall time budget for the search, in ms. */
  budgetMs?: number;
}

// Results the debater sees, and the full-text floor below which the deepen
// round keeps looking.
const RETURN_LIMIT = 12;
const MIN_RESULTS = 3;
// The score the results list labels "High credibility" (components/ArticleResults).
// Only papers at or above it are shown when their full text can't be opened.
const HIGH_CREDIBILITY = 70;
// Full-text count below which an EARLY search keeps looking.
const DEEPEN_BELOW = 5;
// Candidates shown to the ranker per round.
const SHORTLIST = 40;
// Open-web hits admitted to the pool. Tavily returns up to 20 for one credit.
const WEB_LIMIT = 15;
// Expansion queries used in round 1; the rest are saved for round 2.
const ROUND1_EXPANSIONS = 2;
const MAX_EXPANSIONS = 4;
// Verification: parallel fetches per search, per host, and URLs tried per pick.
const VERIFY_CONCURRENCY = 6;
const VERIFY_PER_HOST = 2;
const URLS_PER_PICK = 3;
const ROUND2_VERIFY_PICKS = 8;
// An abstract shorter than this isn't worth offering as a fallback result.
const MIN_ABSTRACT_RESULT_CHARS = 400;

/*
 * Deadlines, in ms from when the search starts. The search route's hard limit
 * is 60s, and auth + quota checks run before the search does; a search killed at
 * the limit sends nothing at all, spends the Tavily credit, and caches nothing.
 */
const INTERACTIVE_BUDGET_MS = 44000;
const BACKGROUND_BUDGET_MS = 25000;
const EXPAND_TIMEOUT_MS = 3500;
const RETRIEVE_BY_MS = 9000;
const RANK_BY_MS = 20000;
const VERIFY_BY_MS = 30000;
const DEEPEN_START_BY_MS = 24000;
// Round 1 finishing this early with fewer than DEEPEN_BELOW full-text results
// still deepens; later, only a result under MIN_RESULTS does.
const EARLY_MS = 18000;
const DEEPEN_RETRIEVE_MS = 6000;
const DEEPEN_RANK_MS = 8000;
// Longest one ranking attempt may take before the next model gets the job. A
// healthy ranking takes ~3-6s; a stalled model was measured at 72s.
const RANK_ATTEMPT_MS = 10000;
const DEEPEN_RANK_ATTEMPT_MS = 6000;
// When too little of round 2 would fit, don't start it.
const DEEPEN_MIN_POOL = 15;

/**
 * Honest failure — nothing to show. The message says WHY (see runSearch): the
 * databases returned nothing, the articles found don't argue the claim, or none
 * of them could be read in full.
 */
export class NoSourcesFoundError extends Error {
  constructor(message = "No reputable sources were found matching your criteria.") {
    super(message);
    this.name = "NoSourcesFoundError";
  }
}

/**
 * Pipeline: (1) the raw claim goes to OpenAlex, Semantic Scholar and the open
 * web at once while Gemini expands it into scholarly keyword queries; (2) the
 * hits are interleaved into one pool; (3) Gemini ranks the pool for debate
 * usefulness and says how each pick fits; (4) every pick is checked for READABLE
 * FULL TEXT, trying the work's other free copies (its PDF, repository copies)
 * when the first link is an abstract page or blocked; (5) if too little full
 * text turned up, a second round ranks and checks more of the pool.
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
 * variant when it differs. These start retrieval immediately; the AI expansion
 * (expandQueries) runs alongside and adds its queries when it lands.
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

const EXPAND_SYSTEM = `You write search queries for scholarly databases (OpenAlex) to find evidence for a debate claim. Write 4 short keyword queries, 3-8 words each, that would find papers ESTABLISHING the claim or its mechanism:
- use the academic field's own vocabulary and synonyms (e.g. "unconditional cash transfers" for "UBI");
- drop debate jargon, rhetoric and hedges;
- vary the angle: the causal mechanism, the outcome measured, the population or setting, the standard term for the phenomenon.
No quotes, no boolean operators, no site: filters.
Return ONLY JSON: {"queries": ["...", "...", "...", "..."]}`;

const expandSchema = z.object({ queries: z.array(z.string()).max(8) });

/** Keep usable, distinct expansion queries (never a repeat of a base query). */
export function cleanExpansions(raw: string[], base: string[]): string[] {
  const seen = new Set(base.map((q) => q.toLowerCase().trim()));
  const out: string[] = [];
  for (const q of raw) {
    const clean = q.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
    const words = clean.split(" ").filter(Boolean).length;
    const key = clean.toLowerCase();
    if (words < 2 || words > 12 || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out.slice(0, MAX_EXPANSIONS);
}

// A Gemini rate limit seen by this instance. Expansion is the optional call, so
// it stands down for a minute rather than adding a 429 that trips the breaker
// the ranker and the card cutter depend on.
let rateLimitedAt = 0;
const RATE_LIMIT_COOLDOWN_MS = 60_000;

const TIMED_OUT = Symbol("timed out");

/** Race `p` against a timer. The abandoned call keeps running; its failure is swallowed. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms));
  });
  p.catch(() => {});
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Ask the AI for scholarly keyword queries. A sentence-length claim is a poor
 * OpenAlex query — measured live, "universal basic income reduces poverty"
 * returned flood exposure, COVID and healthcare-spending papers. Bounded to
 * EXPAND_TIMEOUT_MS and never retried; any failure just means no expansion.
 */
async function expandQueries(params: SearchParams, tier: Tier): Promise<string[]> {
  if (Date.now() - rateLimitedAt < RATE_LIMIT_COOLDOWN_MS) return [];
  try {
    const raw = await withTimeout(
      generateJson({
        system: EXPAND_SYSTEM,
        prompt: `Evidence type: ${params.evidenceType}\nClaim: ${params.claim}`,
        model: modelFor("expand", tier).model,
        maxOutputTokens: 256,
        retries: 0,
        // Cancel it rather than let it run on unseen behind the race below.
        attemptTimeoutMs: EXPAND_TIMEOUT_MS,
      }),
      EXPAND_TIMEOUT_MS,
    );
    if (raw === TIMED_OUT) return [];
    const parsed = expandSchema.safeParse(raw);
    return parsed.success ? cleanExpansions(parsed.data.queries, heuristicQueries(params.claim)) : [];
  } catch (err) {
    if (err instanceof RateLimitedError) rateLimitedAt = Date.now();
    return [];
  }
}

const RANKER_SYSTEM = `${DEBATE_KNOWLEDGE}

You are the ranking stage of a debate evidence search engine. You receive a claim, an evidence type, and a numbered list of REAL articles retrieved from scholarly databases AND the open web (reputable news, think tanks, government and organization reports). Your job is to pick the articles a debater should actually read.

Rules:
- Select ONLY from the provided candidates, by their index number. Never invent an article.
- Judge debate usefulness for THIS claim and THIS evidence type from each abstract/snippet — not just topical overlap. An article that argues the claim is better than one that merely mentions it.
- Both scholarly and reputable web sources are valid evidence. Peer-reviewed journals and university publications carry the most authority for deep warrants and Ks; reputable news, think tanks (e.g. Brookings, RAND, CFR), and government/organization reports are strong for uniqueness, recency, and real-world impacts. Judge each source's credibility on its merits — don't reflexively rank all academic above all web.
- Ranking factors in order: relevance to the exact claim, debate usefulness for the evidence type, source credibility, author/institution expertise, recency.
- For each candidate, work out from its abstract/snippet what the article itself FINDS or ARGUES — not which words it shares with the claim. Classify it:
  • STRONG — argues or evidences the claim's core proposition (same subject, same direction), including a narrower version of it or a more general proposition the claim is plainly an instance of.
  • PARTIAL — on the claim's subject and useful to a debater arguing it: establishes one step of the causal chain, the mechanism, a smaller magnitude or a neighbouring case; OR reports mixed or qualified findings that include support for the claim; OR studies exactly the claim's relationship without stating the finding in its abstract; OR gives the context, trend or background this evidence type needs.
  • DROP — ONLY a different subject that merely shares keywords, a passing mention of the topic, or an article whose conclusion is the OPPOSITE of the claim (it finds the effect absent or reversed).
- ERR TOWARD INCLUSION: a debater can skim a marginal article, but can't read one you hid, and every card is checked against the claim again before it is cut. When unsure between PARTIAL and DROP, choose PARTIAL.
- Scholarly abstracts hedge and report mixed results; web pages argue one side. Don't prefer a web page merely because its snippet states the claim more bluntly than a paper's abstract.
- A web snippet is a fragment of the page. Keep a web page only if the snippet shows the page's own position or evidence on the claim's subject, not merely its keywords.
- A SPECIFIC claim is not a reason to return less. Debaters write narrow claims ("manufacturing contracted because credit tightened for small firms"), and the literature is usually broader than the sentence they typed. An article that establishes PART of the claim, the general mechanism behind it, or the same effect in a neighbouring case is real evidence a debater can use — rank it and say in the explanation exactly which part it carries and which part it does not. Do NOT require an article to argue the whole claim word for word.
- Keep STRONG and PARTIAL; omit DROP. Order STRONG before PARTIAL, then by credibility, evidence-type fit and recency.
- explanation: 1-2 concrete sentences stating what the article finds (at its own scope) and why it fits this evidence type. For PARTIAL, name the part of the claim it does NOT establish (or that its findings are mixed, or that the abstract doesn't state the finding). Never describe an article as supporting more than its abstract/snippet says.
- credibilityScore: 0-100 — how much weight a judge would give this SOURCE, from what kind of publisher it is and the author's expertise. Score the source, not how well it fits the claim. A web page has no citation count; that is not a mark against it.
  • 85-100: peer-reviewed journals and academic presses; working papers from NBER, central banks and major research institutions; official reports and statistics from national governments, central banks and international bodies (e.g. a Federal Reserve bank, CBO, CRS, EIA, HHS, the World Bank, the IMF, NATO); leading think tanks (e.g. Brookings, RAND, CFR, CSIS, Cato, Heritage).
  • 70-84: other established think tanks and research institutes, university centers and faculty writing, major news outlets and reputable magazines, professional and scientific associations.
  • 50-69: advocacy campaigns, industry associations and trade press, general-audience explainers, student-run outlets, opinion blogs by credentialed authors.
  • below 50: commercial or marketing pages, content farms, anonymous or personal blogs, sites selling something related to the claim.
- Pick 8-12 whenever that many on-subject candidates exist (fewer only if the pool is genuinely thin). Return {"selections": []} ONLY when the candidates are about an entirely different subject.

Return ONLY JSON: {"selections": [{"index": 2, "explanation": "...", "fit": "strong"|"partial", "credibilityScore": 87}, ...]} ordered best-first.`;

const rankerSchema = z.object({
  selections: z.array(
    z.object({
      index: z.number().int(),
      explanation: z.string().min(1),
      // A bad value costs only the label, never the whole ranking.
      fit: z.enum(["strong", "partial"]).optional().catch(undefined),
      credibilityScore: z.number().min(0).max(100).catch(50),
    }),
  ),
});

type Selection = z.infer<typeof rankerSchema>["selections"][number];
export type Fit = "strong" | "partial";

/** A ranked candidate, carried through verification with its source record. */
export interface Pick {
  article: Article;
  candidate: CandidateArticle;
  /** The ranker's judgement; undefined when the order wasn't the AI's judgement. */
  fit?: Fit;
}

function candidateToPromptLine(c: CandidateArticle, index: number): string {
  const abstract = c.abstract.length > 700 ? `${c.abstract.slice(0, 700)}…` : c.abstract;
  return [
    `[${index}] ${c.title}`,
    `  Authors: ${c.authors.slice(0, 4).join(", ") || "unknown"}`,
    `  Venue: ${c.venue || "unknown"} | Date: ${c.date || "unknown"} | Citations: ${c.citationCount}`,
    `  ${c.source === "web" ? "Snippet" : "Abstract"}: ${abstract || "(none)"}`,
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
    // article URL can't be fetched. A web hit's text is a search snippet —
    // stitched fragments, not the author's abstract — so it is never offered.
    abstract: c.source === "web" ? undefined : c.abstract,
    // The unmangled people, for the cite (see Article.authors).
    authors: c.authors,
    authorInstitutions: c.authorInstitutions,
  };
}

/**
 * The ranker's picks, in its order. `null` means the answer was MALFORMED —
 * every index out of range — which is not a judgement about relevance.
 */
function picksFromRanking(selections: Selection[], shortlist: CandidateArticle[]): Pick[] | null {
  const valid = selections.filter((s) => s.index >= 0 && s.index < shortlist.length);
  if (selections.length > 0 && valid.length === 0) return null;
  const seen = new Set<number>();
  return valid
    .filter((s) => !seen.has(s.index) && Boolean(seen.add(s.index)))
    .map((s) => ({
      article: candidateToArticle(shortlist[s.index], s.explanation, s.credibilityScore),
      candidate: shortlist[s.index],
      fit: s.fit,
    }));
}

/**
 * Turn the ranker's picks into articles.
 *
 * A JUDGED empty list returns nothing: showing those articles anyway, ordered by
 * citations, is how debaters were handed articles unrelated to their claim.
 * Only a malformed answer (every index out of range) falls back to non-AI
 * ordering. The caller searches further before reporting "nothing".
 */
export function articlesFromRanking(
  selections: Array<{ index: number; explanation: string; credibilityScore: number; fit?: Fit }>,
  shortlist: CandidateArticle[],
  claim = "",
): Article[] {
  const picks = picksFromRanking(selections, shortlist);
  if (picks !== null) return picks.map((p) => p.article);
  console.warn("articleFinder: every ranked pick was out of range; using keyword ranking");
  return keywordRanking(claim, shortlist).map((p) => p.article);
}

const STOPWORDS = new Set(
  "the a an and or of to in on for by with from as at is are was were be been being that this these those it its into than then which who whom whose what when where why how not no can could would should will may might must more most less least very also only just".split(
    " ",
  ),
);

/** Content words of a text, lightly stemmed, for keyword matching. */
function contentTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    // "reduce", "reduces", "reduced", "reducing" all become "reduc".
    out.add(word.length > 4 ? word.replace(/(ing|ed|es|s|e)$/, "") : word);
  }
  return out;
}

const KEYWORD_EXPLANATION =
  "Ranked by keyword match while the AI ranker was busy — relevance to your claim isn't verified, so skim the abstract before you cut.";

/**
 * Non-AI ordering for when the ranker is rate-limited, times out or answers
 * malformed. It used to be citation count alone, which put a 9,000-citation
 * paper about floods above a paper about the claim. Now: how much of the claim
 * the title (weighted) and abstract actually mention, with citations and
 * recency only breaking ties. Honest that fit is unverified.
 */
export function keywordRanking(claim: string, candidates: CandidateArticle[], limit = RETURN_LIMIT): Pick[] {
  const claimTerms = [...contentTerms(claim)];
  const relevance = (c: CandidateArticle): number => {
    if (claimTerms.length === 0) return 0;
    const title = contentTerms(c.title);
    const abstract = contentTerms(c.abstract);
    const hits = claimTerms.reduce((n, t) => n + (title.has(t) ? 2 : 0) + (abstract.has(t) ? 1 : 0), 0);
    return hits / (3 * claimTerms.length);
  };
  const standing = (c: CandidateArticle): number => {
    const citations = Math.min(40, Math.log10(c.citationCount + 1) * 15);
    const year = Number.parseInt(c.date.slice(0, 4), 10);
    const recency = Number.isFinite(year) ? Math.min(15, Math.max(0, year - 2010)) : 0;
    return 50 + citations + recency + (c.venue ? 10 : 0);
  };
  return candidates
    .map((c) => ({ c, rel: relevance(c), std: standing(c) }))
    .filter((x) => claimTerms.length === 0 || x.rel > 0)
    .sort((a, b) => b.rel - a.rel || b.std - a.std)
    .slice(0, limit)
    .map(({ c, std }) => ({
      article: candidateToArticle(c, KEYWORD_EXPLANATION, Math.round(Math.min(90, std))),
      candidate: c,
    }));
}

/** Round-robin across buckets: the best of each before the second-best of any. */
export function interleave<T>(buckets: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...buckets.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const bucket of buckets) if (i < bucket.length) out.push(bucket[i]);
  }
  return out;
}

/**
 * Whatever of `promises` has settled by `deadlineAt`; the rest (and failures)
 * are `empty`. Retrieval keeps its deadline even when one database is slow.
 */
export async function settleBy<T>(promises: Array<Promise<T>>, deadlineAt: number, empty: T): Promise<T[]> {
  const results: T[] = promises.map(() => empty);
  const all = Promise.all(
    promises.map((p, i) =>
      p.then(
        (v) => {
          results[i] = v;
        },
        () => {},
      ),
    ),
  );
  await withTimeout(all, deadlineAt - Date.now());
  return [...results];
}

const isDoiUrl = (url: string) => /^https?:\/\/(dx\.)?doi\.org\//i.test(url);
const isS2PaperPage = (url: string) => /semanticscholar\.org\/paper\//i.test(url);

/**
 * The URLs to try for one result, in order: its own link and its other free
 * copies — never a URL built by us. DOIs go last (they redirect through
 * publishers that rarely serve the text to a server), a search engine's own
 * paper page is skipped (it never holds the text), and alternates on non-citable
 * domains are dropped (filterReputable only ever saw the primary URL).
 */
export function verifyOrder(c: CandidateArticle): string[] {
  const urls = [...new Set([c.url, ...(c.fullTextUrls ?? [])])].filter(
    (u) => isFetchableUrl(u) && !isBlockedDomain(u) && !isS2PaperPage(u),
  );
  return [...urls.filter((u) => !isDoiUrl(u)), ...urls.filter(isDoiUrl)];
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

// Hosts that only redirect to the real publisher — never blamed for a refusal.
const REDIRECTOR_HOSTS = new Set(["doi.org", "dx.doi.org", "hdl.handle.net"]);

/** Hosts that refused us this search, and per-host concurrency. */
interface HostState {
  refused: Set<string>;
  slots: Map<string, ReturnType<typeof createLimiter>>;
}

const newHostState = (): HostState => ({ refused: new Set(), slots: new Map() });

/**
 * Check each pick for READABLE FULL TEXT, trying its other free copies when the
 * first link is an abstract page or refuses us. A pick that passes carries the
 * URL that actually yielded the text, so the cut goes there too.
 *
 * Bounded three ways: a deadline (in-flight downloads are aborted at it), six
 * fetches at a time (two per host), and a per-search list of hosts that have
 * already refused — one 403 from a publisher means its next link will 403 too.
 */
async function verifyPicks(
  picks: Pick[],
  deadlineAt: number,
  hosts: HostState,
): Promise<{ fullText: Pick[]; abstractOnly: Pick[] }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.max(0, deadlineAt - Date.now()));
  try {
    const outcomes = await mapWithConcurrency(picks, VERIFY_CONCURRENCY, async (pick) => {
      for (const url of verifyOrder(pick.candidate).slice(0, URLS_PER_PICK)) {
        const left = deadlineAt - Date.now();
        if (left < 1500) break;
        const host = hostOf(url);
        if (hosts.refused.has(host)) continue;
        let slot = hosts.slots.get(host);
        if (!slot) hosts.slots.set(host, (slot = createLimiter(VERIFY_PER_HOST)));
        // The abort stops downloads at the deadline, but not what follows them
        // (waiting for a PDF-parse slot, the parse, Readability), so the wait
        // itself is also capped: past the deadline this pick simply isn't full
        // text, whatever the check is still doing.
        const check = await withTimeout(
          slot(() =>
            verifyAccessible(url, {
              timeoutMs: Math.min(6500, left),
              signal: abort.signal,
              // A web hit's "abstract" is a search snippet quoting the page's
              // own lede; treating it as an abstract would strip that lede.
              abstract: pick.candidate.source === "web" ? undefined : pick.candidate.abstract,
            }),
          ),
          deadlineAt - Date.now(),
        );
        if (check === TIMED_OUT) break;
        if (check.ok) return { pick, url };
        // A redirector (doi.org, handle.net) isn't the host that refused: one
        // publisher's 403 behind a DOI says nothing about the next DOI.
        const refused = check.reason === "blocked" || check.reason === "paywall";
        if (refused && !REDIRECTOR_HOSTS.has(host)) hosts.refused.add(host);
      }
      return { pick, url: null };
    });
    const fullText: Pick[] = [];
    const abstractOnly: Pick[] = [];
    for (const { pick, url } of outcomes) {
      if (url) fullText.push({ ...pick, article: { ...pick.article, url, accessible: true } });
      else abstractOnly.push({ ...pick, article: { ...pick.article, accessible: false } });
    }
    return { fullText, abstractOnly };
  } finally {
    clearTimeout(timer);
  }
}

/** Keep the first of each URL — two results can land on the same PDF after a swap. */
function uniqueByUrl(articles: Article[]): Article[] {
  const seen = new Set<string>();
  return articles.filter((a) => !seen.has(a.url) && Boolean(seen.add(a.url)));
}

/** The credibility band the results list shows: High / Medium / Low. */
const credibilityBand = (score: number): number => (score >= HIGH_CREDIBILITY ? 2 : score >= 50 ? 1 : 0);

/**
 * What the debater sees: full text, plus the HIGH-credibility papers whose full
 * text couldn't be opened, labelled `accessible: false` so the UI says so.
 *
 * Showing full text only hid the best sources: publishers refuse automated
 * readers, so about half the journal papers the ranker picked failed the check
 * while ordinary web pages passed, and results came back mostly medium
 * credibility. An abstract-only pick is still one the cutter could use — judged
 * relevant, with a real abstract — and the cutter only cuts it when that
 * abstract directly supports the claim.
 *
 * Order: high credibility first; within a band, full text before abstract-only;
 * otherwise the ranker's order.
 */
export function selectResults(
  fullText: Article[],
  abstractOnly: Array<{ article: Article; fit?: Fit }>,
): Article[] {
  const full = fullText.map((a) => ({ ...a, accessible: true }));
  const papers = abstractOnly
    .filter(
      (p) =>
        p.fit !== undefined &&
        p.article.credibilityScore >= HIGH_CREDIBILITY &&
        (p.article.abstract?.length ?? 0) >= MIN_ABSTRACT_RESULT_CHARS,
    )
    .map((p) => ({ ...p.article, accessible: false }));
  const ordered = [...full, ...papers]
    .map((a, i) => ({ a, i }))
    .sort(
      (x, y) =>
        credibilityBand(y.a.credibilityScore) - credibilityBand(x.a.credibilityScore) ||
        Number(y.a.accessible) - Number(x.a.accessible) ||
        x.i - y.i,
    )
    .map(({ a }) => a);
  return uniqueByUrl(ordered).slice(0, RETURN_LIMIT);
}

/**
 * Rank a shortlist. Round 1 uses the tier's ranking model and falls back to
 * keyword ranking when the AI can't judge (rate limit, timeout, malformed
 * answer). Round 2 always runs on the lite model — the strong model's daily
 * allowance is tiny — and on any failure simply finds nothing more.
 */
async function rankCandidates(
  shortlist: CandidateArticle[],
  params: SearchParams,
  tier: Tier,
  opts: { deadlineAt: number; round: 1 | 2 },
): Promise<{ picks: Pick[]; judged: boolean }> {
  const unjudged = () =>
    opts.round === 1
      ? { picks: keywordRanking(params.claim, shortlist), judged: false }
      : { picks: [], judged: false };

  const prompt = [
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

  let raw: unknown;
  try {
    raw = await withTimeout(
      generateJson({
        system: RANKER_SYSTEM,
        prompt,
        maxOutputTokens: 2048,
        // Pro/admin rank on the stronger judgement model; free stays on lite.
        // When the strong model is out of quota, rank on the cheap model rather
        // than dropping to keyword ordering, which never reads the abstracts.
        model: opts.round === 1 ? modelFor("rank", tier).model : modelFor("expand", tier).model,
        fallbackModel: opts.round === 1 ? (fallbackFor("rank", tier) ?? undefined) : undefined,
        retries: opts.round === 1 && tier === "free" ? 1 : 0,
        // A model that hasn't answered by then is stalled, not thinking — hand
        // the ranking to the next model while the deadline still has room for
        // it. Without this one stalled call ran out the whole deadline and the
        // debater got keyword ordering.
        attemptTimeoutMs: opts.round === 1 ? RANK_ATTEMPT_MS : DEEPEN_RANK_ATTEMPT_MS,
      }),
      opts.deadlineAt - Date.now(),
    );
  } catch (err) {
    // A missing key is a configuration error the route must report. Anything
    // else — a rate limit, a 400 from the model, an outage — only costs the
    // ORDER: retrieval already found real articles, so degrade rather than
    // throw a whole search (and, in round 2, round 1's results) away.
    if (err instanceof MissingApiKeyError) throw err;
    if (err instanceof RateLimitedError) rateLimitedAt = Date.now();
    console.warn(`articleFinder: round-${opts.round} ranker failed; degrading`, String(err));
    return unjudged();
  }
  if (raw === TIMED_OUT) {
    console.warn(`articleFinder: round-${opts.round} ranker timed out`);
    return unjudged();
  }
  const parsed = rankerSchema.safeParse(raw);
  if (!parsed.success) {
    /*
     * Degrade instead of failing: retrieval already found REAL articles; only
     * the model's opinion about their ORDER came back malformed. Observed live,
     * a search with six usable sources once reported "unreadable result" here.
     */
    console.warn(`articleFinder: unparseable round-${opts.round} ranking`, parsed.error.message);
    return unjudged();
  }
  const picks = picksFromRanking(parsed.data.selections, shortlist);
  if (picks === null) {
    console.warn(`articleFinder: every round-${opts.round} pick was out of range`);
    return unjudged();
  }
  return { picks, judged: true };
}

const titleKey = (c: CandidateArticle) => c.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Why a search that DID retrieve articles has nothing to show — each case needs
 * a different next step from the debater, so each gets its own honest message.
 */
export function emptyResultMessage(
  retrieved: number,
  picked: number,
  judgedNothing: boolean,
  anyJudged = true,
): string {
  if (judgedNothing) {
    return `Found ${retrieved} articles on this subject, but none of them argue this claim. Try a broader or differently worded claim.`;
  }
  if (picked === 0) {
    return `Found ${retrieved} articles, but the AI ranker was busy and none of them clearly match your claim. Try again in a minute.`;
  }
  if (!anyJudged) {
    // Keyword picks were never judged relevant — don't call them that.
    return `Found ${picked} possible sources while the AI ranker was busy, but none had full text we could read. Try again in a minute.`;
  }
  return `Found ${picked} relevant sources, but none had full text we could read and none of the rest were high-credibility papers with a usable abstract. Open one yourself and paste its full text into Cut a Card.`;
}

/**
 * Record each result's real metadata and its other copies, so a cut that arrives
 * without them — from the Coach, or after the result was swapped to its PDF —
 * still cites the right people and can fall back to another copy.
 */
async function rememberResults(results: Article[], picks: Pick[]): Promise<void> {
  const byUrl = new Map(picks.map((p) => [p.article.url, p]));
  const writes = results.map((a) => {
    const pick = byUrl.get(a.url);
    return rememberSourceMeta(a.url, {
      title: a.title,
      author: a.author,
      authors: a.authors,
      authorInstitutions: a.authorInstitutions,
      publication: a.publication,
      date: a.date,
      fallbackUrls: pick ? verifyOrder(pick.candidate).filter((u) => u !== a.url) : [],
    });
  });
  // Bounded: a slow cache must never hold the debater's results hostage.
  await withTimeout(Promise.all(writes), REMEMBER_TIMEOUT_MS);
}

const REMEMBER_TIMEOUT_MS = 1500;

// Repeat searches (same params) reuse the result for 30 min — zero AI cost.
// Shared across instances/users via Redis when configured (in-memory otherwise).
// Bumped whenever cached results go wrong: "search2" for full-text-only
// filtering, "search3" for the looser ranker and high-credibility papers shown
// abstract-only.
const searchCache = createSharedCache<Article[]>({
  ttlMs: 30 * 60 * 1000,
  namespace: "search3",
});

// Tier is part of the key: free ranks on the lite model and pro/admin on the
// strong one, so their result orderings differ and must not share a cache slot.
// So is the deepen flag: a background search looks less far.
function searchCacheKey(p: SearchParams, tier: Tier, deepen: boolean): string {
  return JSON.stringify([
    tier,
    deepen ? "deep" : "quick",
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
  opts: FindOptions = {},
): Promise<Article[]> {
  const interactive = onStage !== undefined;
  const deepen = opts.deepen ?? interactive;
  const budgetMs = opts.budgetMs ?? (interactive ? INTERACTIVE_BUDGET_MS : BACKGROUND_BUDGET_MS);
  // Only a search the AI actually ranked is shared: keyword ordering while the
  // ranker was busy is a stopgap, not an answer to serve everyone for 30 min.
  let judged = false;
  return searchCache.wrap(
    searchCacheKey(params, tier, deepen),
    async () => {
      const outcome = await runSearch(params, clientKey, onStage, tier, { deepen, budgetMs });
      judged = outcome.judged;
      return outcome.articles;
    },
    () => judged,
  );
}

async function runSearch(
  params: SearchParams,
  clientKey: string | undefined,
  onStage: StageReporter | undefined,
  tier: Tier,
  opts: Required<FindOptions>,
): Promise<{ articles: Article[]; judged: boolean }> {
  const started = Date.now();
  const at = (ms: number) => started + Math.min(ms, opts.budgetMs);
  const finalBy = started + opts.budgetMs;

  // 1. RETRIEVE. The raw claim goes to every source immediately; the AI's
  //    keyword queries join when they land. Only the raw claim goes to Semantic
  //    Scholar without a key (its shared pool rate-limits hard) and only it goes
  //    to the web (one Tavily credit per search).
  onStage?.("retrieve");
  const base = heuristicQueries(params.claim);
  const hasS2Key = Boolean(process.env.SEMANTIC_SCHOLAR_API_KEY);
  const expansionP = expandQueries(params, tier);
  const webP = searchWeb(base.slice(0, 1), clientKey)
    .then((hits) => hits.slice(0, WEB_LIMIT))
    .catch(() => [] as CandidateArticle[]);
  const baseBuckets = searchAcademicBuckets(base, params.publicationAge, { semanticScholarQueries: 1 });
  const expansions = await expansionP;
  const expansionBuckets = searchAcademicBuckets(expansions.slice(0, ROUND1_EXPANSIONS), params.publicationAge, {
    semanticScholarQueries: hasS2Key ? 1 : 0,
  });
  const [firstBucket = Promise.resolve([]), ...otherBase] = baseBuckets;
  const buckets = await settleBy(
    [firstBucket, webP, ...otherBase, ...expansionBuckets],
    at(RETRIEVE_BY_MS),
    [] as CandidateArticle[],
  );

  // Drop non-citable domains, then merge duplicates (keeping every copy's URL).
  const pool = dedupeCandidates(filterReputable(interleave(buckets)));
  if (pool.length === 0) throw new NoSourcesFoundError();
  const shortlist = pool.slice(0, SHORTLIST);
  const shownToRanker = new Set(shortlist.map(titleKey));

  // 2. RANK over ONLY the retrieved candidates.
  onStage?.("rank");
  const round1 = await rankCandidates(shortlist, params, tier, { deadlineAt: at(RANK_BY_MS), round: 1 });
  let judgedNothing = round1.judged && round1.picks.length === 0;
  let anyJudged = round1.judged;
  let picksMade = round1.picks.length;

  // 3. VERIFY: which picks have full text a debater can open and cut from.
  const hosts = newHostState();
  let fullText: Pick[] = [];
  let abstractOnly: Pick[] = [];
  if (round1.picks.length > 0) {
    onStage?.("verify");
    ({ fullText, abstractOnly } = await verifyPicks(round1.picks, at(VERIFY_BY_MS), hosts));
  }

  // 4. DEEPEN when full text is thin (or nothing argued the claim) and there's
  //    time: rank the candidates round 1 never showed the ranker, fetching a
  //    second page only if that pool is small, then check those too.
  const elapsed = Date.now() - started;
  const thin =
    fullText.length < MIN_RESULTS || (fullText.length < DEEPEN_BELOW && elapsed <= EARLY_MS);
  if (opts.deepen && (thin || judgedNothing) && Date.now() <= at(DEEPEN_START_BY_MS)) {
    onStage?.("deepen");
    const before = fullText.length;
    let pool2 = pool.slice(SHORTLIST);
    if (pool2.length < DEEPEN_MIN_POOL) {
      // Further down the raw claim's ranking, plus the expansion queries round
      // 1 never ran at all (their FIRST page — the best they have).
      const more = await settleBy(
        [
          ...searchAcademicBuckets([base[0]], params.publicationAge, { page: 2, semanticScholarQueries: 0 }),
          ...searchAcademicBuckets(expansions.slice(ROUND1_EXPANSIONS), params.publicationAge, {
            semanticScholarQueries: 0,
          }),
        ],
        Math.min(Date.now() + DEEPEN_RETRIEVE_MS, finalBy - 12000),
        [] as CandidateArticle[],
      );
      pool2 = dedupeCandidates(filterReputable([...pool2, ...interleave(more)]));
    }
    const shortlist2 = pool2.filter((c) => !shownToRanker.has(titleKey(c))).slice(0, SHORTLIST);
    if (shortlist2.length > 0) {
      const round2 = await rankCandidates(shortlist2, params, tier, {
        deadlineAt: Math.min(Date.now() + DEEPEN_RANK_MS, finalBy - 8000),
        round: 2,
      });
      anyJudged ||= round2.judged;
      if (round2.picks.length > 0) {
        judgedNothing = false;
        picksMade += round2.picks.length;
        const more = await verifyPicks(round2.picks.slice(0, ROUND2_VERIFY_PICKS), finalBy, hosts);
        fullText = [...fullText, ...more.fullText];
        abstractOnly = [...abstractOnly, ...more.abstractOnly];
      }
    }
    // The measurement that decides whether this round earns its keep.
    console.info(`articleFinder: deepen added ${fullText.length - before} full-text result(s)`);
  }

  const results = selectResults(
    fullText.map((p) => p.article),
    abstractOnly,
  );
  if (results.length === 0) {
    throw new NoSourcesFoundError(emptyResultMessage(pool.length, picksMade, judgedNothing, anyJudged));
  }
  await rememberResults(results, [...fullText, ...abstractOnly]);
  return { articles: results, judged: anyJudged };
}
