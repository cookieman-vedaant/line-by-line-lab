import type { PublicationAge } from "@/types";

/**
 * Free academic retrieval — no API keys, no cost.
 * OpenAlex (~250M works, no auth) + Semantic Scholar (no key, shared rate pool).
 * Every candidate here comes from a real scholarly database, so fabricated
 * articles are structurally impossible: the AI only ranks what these return.
 */

/** A raw search hit before debate-aware ranking. */
export interface CandidateArticle {
  title: string;
  authors: string[];
  venue: string;
  date: string; // YYYY-MM-DD or YYYY
  url: string;
  abstract: string;
  citationCount: number;
  source: "openalex" | "semanticscholar" | "web";
  /**
   * The first author's institutions, straight from OpenAlex. This is the only
   * author-qualification source in the app that costs nothing and can't be
   * hallucinated — the debater gets "Professor, Harvard University" in the cite
   * because OpenAlex says so, not because a model guessed.
   */
  authorInstitutions?: string[];
}

const FETCH_TIMEOUT_MS = 10000;

/**
 * OpenAlex's "polite pool". Sending a contact address moves a request out of the
 * anonymous pool and into one with real rate limits.
 *
 * This is not an optimisation — it is the difference between working and not.
 * As of Aug 2026 OpenAlex rejects anonymous SEARCH outright:
 *
 *   {"error":"Rate limit exceeded","message":"Anonymous search is temporarily
 *    rate-limited while the search cluster ..."}
 *
 * Measured live: the exact query the app sends returns 429 every time bare and
 * 200 with 20 results the moment `mailto` is attached. Without it the Article
 * Finder silently loses its entire scholarly half and runs on web hits alone —
 * no real authors, no dates, no open-access full text.
 *
 * Override with OPENALEX_MAILTO. The default is a real, monitored address for
 * this app; OpenAlex only needs somewhere to reach us if a query misbehaves.
 */
const OPENALEX_MAILTO = process.env.OPENALEX_MAILTO || "thelinebylinelab@gmail.com";
const USER_AGENT = `LineByLineLab/1.0 (mailto:${OPENALEX_MAILTO})`;

/**
 * Retry a rate-limited scholarly request with exponential backoff.
 *
 * Semantic Scholar's keyless pool is shared across every anonymous caller on the
 * internet, so a 429 is routine and usually clears within a second or two. One
 * bare attempt threw away results that a short wait would have returned; the
 * search still degrades gracefully if every attempt fails.
 */
async function withRetry<T>(
  label: string,
  attempt: () => Promise<T>,
  // Four, not three: measured against the live APIs, OpenAlex still 429s
  // intermittently even inside the polite pool, and a query that returned
  // nothing on attempt three returned 20 results on attempt four. Both
  // providers run in parallel with the web search, so the worst case costs
  // ~3.5s of a ~10s budget and only on requests that would otherwise be empty.
  attempts = 4,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
      const rateLimited = err instanceof Error && /\b429\b/.test(err.message);
      // Only a rate limit is worth waiting out. A 404 or a parse error will
      // fail identically no matter how long we sleep.
      if (!rateLimited || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}

/** OpenAlex stores abstracts as {word: [positions]}; rebuild the plain text. */
export function reconstructAbstract(
  inverted: Record<string, number[]> | null | undefined,
): string {
  if (!inverted) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }
  return words.filter(Boolean).join(" ");
}

/** Map the "Max Publication Age" filter to a from-date, or null for Any. */
export function publicationAgeToFromDate(
  age: PublicationAge | undefined,
  today: Date = new Date(),
): string | null {
  if (!age || age === "Any") return null;
  const d = new Date(today);
  switch (age) {
    case "6 months":
      d.setMonth(d.getMonth() - 6);
      break;
    case "1 year":
      d.setFullYear(d.getFullYear() - 1);
      break;
    case "2 years":
      d.setFullYear(d.getFullYear() - 2);
      break;
    case "5 years":
      d.setFullYear(d.getFullYear() - 5);
      break;
  }
  return d.toISOString().slice(0, 10);
}

interface OpenAlexLocation {
  landing_page_url?: string;
  pdf_url?: string;
  version?: string;
  source?: { display_name?: string };
}

interface OpenAlexWork {
  display_name?: string;
  publication_date?: string;
  cited_by_count?: number;
  doi?: string;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: {
    author?: { display_name?: string };
    institutions?: { display_name?: string }[];
  }[];
  primary_location?: OpenAlexLocation;
  best_oa_location?: OpenAlexLocation | null;
}

/**
 * Pick the most *fetchable* URL for a work. An open-access HTML landing page
 * (PMC, arXiv abstract, institutional repo) can be read by Readability; a bare
 * DOI usually redirects to a paywalled/JS publisher page that can't. Prefer OA
 * HTML → primary landing page → DOI. We skip pdf_url: our extractor is
 * HTML-only, so a PDF link would just fail (the abstract fallback covers those).
 */
export function pickWorkUrl(w: OpenAlexWork): string {
  const oa = w.best_oa_location;
  if (oa?.landing_page_url && !/\.pdf($|\?)/i.test(oa.landing_page_url)) {
    return oa.landing_page_url;
  }
  return w.primary_location?.landing_page_url ?? w.doi ?? "";
}

async function searchOpenAlex(query: string, fromDate: string | null): Promise<CandidateArticle[]> {
  const params = new URLSearchParams({
    search: query,
    "per-page": "20",
    sort: "relevance_score:desc",
    // Polite pool — see OPENALEX_MAILTO. Without this the request is 429'd.
    mailto: OPENALEX_MAILTO,
  });
  // open_access.is_oa:true — only works a debater can actually READ for free
  // (free full text exists), so results are far more likely to be cuttable.
  const filters = ["has_abstract:true", "open_access.is_oa:true"];
  if (fromDate) filters.push(`from_publication_date:${fromDate}`);
  params.set("filter", filters.join(","));

  const data = await withRetry("OpenAlex", async () => {
    const res = await fetch(`https://api.openalex.org/works?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OpenAlex responded ${res.status}`);
    return (await res.json()) as { results?: OpenAlexWork[] };
  });

  return (data.results ?? []).flatMap((w): CandidateArticle[] => {
    const url = pickWorkUrl(w);
    if (!w.display_name || !url) return [];
    return [
      {
        title: w.display_name,
        authors: (w.authorships ?? [])
          .map((a) => a.author?.display_name ?? "")
          .filter(Boolean),
        venue: w.primary_location?.source?.display_name ?? "",
        date: w.publication_date ?? "",
        url,
        abstract: reconstructAbstract(w.abstract_inverted_index),
        citationCount: w.cited_by_count ?? 0,
        source: "openalex",
        // First author's affiliations — the cite's qualification, stated by the
        // database rather than inferred by a model.
        authorInstitutions: (w.authorships?.[0]?.institutions ?? [])
          .map((i) => i.display_name ?? "")
          .filter(Boolean),
      },
    ];
  });
}

interface S2Paper {
  title?: string;
  abstract?: string | null;
  venue?: string | null;
  url?: string | null;
  publicationDate?: string | null;
  year?: number | null;
  citationCount?: number | null;
  authors?: { name?: string }[];
}

async function searchSemanticScholar(
  query: string,
  fromDate: string | null,
): Promise<CandidateArticle[]> {
  const params = new URLSearchParams({
    query,
    limit: "12",
    fields: "title,abstract,venue,url,publicationDate,year,citationCount,authors",
  });
  if (fromDate) params.set("publicationDateOrYear", `${fromDate}:`);

  // A free key (semanticscholar.org/product/api) lifts the shared anonymous
  // pool's limit. Optional: without it the retry below usually still gets through.
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;

  const data = await withRetry("Semantic Scholar", async () => {
    const res = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
      {
        headers: {
          "User-Agent": USER_AGENT,
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`Semantic Scholar responded ${res.status}`);
    return (await res.json()) as { data?: S2Paper[] };
  });

  return (data.data ?? []).flatMap((p): CandidateArticle[] => {
    if (!p.title || !p.url) return [];
    return [
      {
        title: p.title,
        authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
        venue: p.venue ?? "",
        date: p.publicationDate ?? (p.year ? String(p.year) : ""),
        url: p.url,
        abstract: p.abstract ?? "",
        citationCount: p.citationCount ?? 0,
        source: "semanticscholar",
      },
    ];
  });
}

/** Dedupe by normalized title, preferring the hit with the richer abstract. */
export function dedupeCandidates(candidates: CandidateArticle[]): CandidateArticle[] {
  const byTitle = new Map<string, CandidateArticle>();
  for (const c of candidates) {
    const key = c.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const existing = byTitle.get(key);
    if (!existing || c.abstract.length > existing.abstract.length) {
      byTitle.set(key, c);
    }
  }
  return [...byTitle.values()];
}

/**
 * Run every query against both databases in parallel. A single source failing
 * (rate limit, outage) degrades gracefully instead of failing the search.
 */
export async function searchAcademic(
  queries: string[],
  publicationAge: PublicationAge | undefined,
): Promise<CandidateArticle[]> {
  const fromDate = publicationAgeToFromDate(publicationAge);

  const settled = await Promise.allSettled(
    queries.flatMap((q) => [searchOpenAlex(q, fromDate), searchSemanticScholar(q, fromDate)]),
  );

  const candidates = settled
    .filter((r): r is PromiseFulfilledResult<CandidateArticle[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);

  const failures = settled.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    console.warn(
      `academicSearch: ${failures.length}/${settled.length} sub-searches failed`,
      failures.map((f) => String(f.reason)),
    );
  }

  return dedupeCandidates(candidates);
}
