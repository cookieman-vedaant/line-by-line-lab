import { consumeWebSearch } from "@/lib/rateLimit";
import { type CandidateArticle } from "@/services/academicSearch";

/**
 * Open-web retrieval via Tavily (free tier: 1,000 searches/month, NO credit
 * card — sign in and copy one API key). Brings reputable NEWS / think-tank /
 * .gov / .org coverage the scholarly databases miss — the "general uniqueness"
 * breadth debaters need.
 *
 * Results come back in the same {@link CandidateArticle} shape so they merge and
 * rank alongside academic hits. With NO key configured, this returns [] and the
 * search degrades to academic-only — so the app keeps working either way.
 * Configure TAVILY_API_KEY in .env.local.
 */

const ENDPOINT = "https://api.tavily.com/search";
const FETCH_TIMEOUT_MS = 9000;
const RESULTS_PER_QUERY = 10;
// ONE query per app-search = 1 Tavily credit, doubling how far the free
// 1,000/month tier stretches. A single query still returns 10 web results.
const MAX_QUERIES = 1;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

/** Lowercase hostname (www. stripped) for a result's publication label. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Pull a YYYY-MM-DD out of Tavily's published_date, else "". */
function isoDate(raw: string | undefined): string {
  if (!raw) return "";
  const m = raw.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}

/** Map one Tavily result to a CandidateArticle, or null if it lacks a title/url. */
export function tavilyResultToCandidate(r: TavilyResult): CandidateArticle | null {
  if (!r.title || !r.url) return null;
  return {
    title: r.title.trim(),
    // Web pages rarely expose a machine-readable author; leave empty so the card
    // cite falls back to the publication (never fabricate an author).
    authors: [],
    venue: hostnameOf(r.url),
    date: isoDate(r.published_date),
    url: r.url,
    abstract: (r.content ?? "").trim(),
    citationCount: 0,
    source: "web",
  };
}

async function searchOnce(query: string, key: string): Promise<CandidateArticle[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query,
      max_results: RESULTS_PER_QUERY,
      search_depth: "basic",
      topic: "general",
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Tavily responded ${res.status}`);
  const data: TavilyResponse = await res.json();

  return (data.results ?? []).flatMap((r) => {
    const candidate = tavilyResultToCandidate(r);
    return candidate ? [candidate] : [];
  });
}

/**
 * Run the (already debate-expanded) queries against Tavily and return real web
 * articles. Runs in parallel; any single query failing (quota, outage) is
 * swallowed so the overall search degrades gracefully instead of failing.
 * Recency isn't filtered here — that's handled by the academic tier and the
 * debate-aware ranker; the web tier's job is breadth.
 *
 * `clientKey` (when provided) is rate-limited: once a client is over its daily
 * cap — or the app is over its monthly budget — this returns [] and the search
 * falls back to academic-only, protecting the free Tavily credit budget.
 */
export async function searchWeb(
  queries: string[],
  clientKey?: string,
): Promise<CandidateArticle[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return []; // not configured → open-web tier is simply off

  if (clientKey && !consumeWebSearch(clientKey)) {
    console.info(`webSearch: "${clientKey}" over web-search cap → academic-only`);
    return [];
  }

  const picked = queries.slice(0, MAX_QUERIES);

  const settled = await Promise.allSettled(picked.map((q) => searchOnce(q, key)));

  const out: CandidateArticle[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") out.push(...r.value);
    else console.warn(`webSearch: query "${picked[i]}" failed`, String(r.reason));
  }
  return out;
}
