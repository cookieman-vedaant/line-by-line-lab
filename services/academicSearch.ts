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
  /**
   * Other places the SAME work's free full text may live — the open-access PDF,
   * repository copies, the publisher page — best first, never including `url`.
   *
   * `url` is often a DOI or landing page that redirects to a paywalled or
   * bot-blocked publisher site, while the database record also names a free PDF.
   * Measured live: 14 of 20 open-access works were offered that way. The Article
   * Finder tries these when `url` doesn't yield readable full text, instead of
   * writing off a paper a debater could actually read.
   */
  fullTextUrls?: string[];
}

/**
 * Hosts that identify a PERSON or record, never an article. OpenAlex
 * occasionally stores one as a work's "landing page" (seen live: an ORCID
 * profile with scraped markup glued on), and fetching it can only fail.
 */
const NON_ARTICLE_HOSTS = ["orcid.org"];

/** A URL worth fetching for article text: parseable http(s), not an identifier page. */
export function isFetchableUrl(raw: string | null | undefined): raw is string {
  if (!raw || /[\s<>"]/.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return !NON_ARTICLE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Fetchable URLs from a list, in order, each once. */
function uniqueFetchable(urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.filter(isFetchableUrl))];
}

/** Split an ordered URL list into the primary `url` and its full-text alternates. */
function primaryAndAlternates(urls: string[]): { url: string; fullTextUrls: string[] } {
  return { url: urls[0] ?? "", fullTextUrls: urls.slice(1, 1 + MAX_ALTERNATES) };
}

// Enough to reach a work's free PDF and one repository copy, without letting
// the Article Finder's verification step fetch half a dozen copies of one paper.
const MAX_ALTERNATES = 4;

const FETCH_TIMEOUT_MS = 10000;
// Results per query per database. OpenAlex's relevance order is loose on a
// sentence-length query, so a slightly deeper page gives the ranker more real
// candidates to choose from; S2 is restricted to open-access PDFs (see below),
// so each hit is worth more there too.
const OPENALEX_PER_PAGE = 25;
const S2_LIMIT = 20;

// Without an API key, after this many rate-limited Semantic Scholar searches in
// a row, stop asking it for a while (per instance) rather than making every
// search wait out a pool that is refusing everyone.
const S2_COOLDOWN_AFTER = 3;
const S2_COOLDOWN_MS = 5 * 60 * 1000;
let s2Consecutive429 = 0;
let s2CooldownUntil = 0;

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
  is_oa?: boolean;
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
  /** Every copy of the work OpenAlex knows about, open or not. */
  locations?: OpenAlexLocation[];
}

const isPdfUrl = (url: string | undefined): boolean => !!url && /\.pdf($|\?)/i.test(url);

/**
 * Every URL where a work's text might be read, most *fetchable* first.
 *
 * An open-access HTML page (PMC, a publisher's OA article, a repository) is
 * cleanest to extract and carries the metadata the cite needs, so it leads. The
 * OA PDF is next — real, free full text the extractor reads. Other open copies
 * follow, and the primary landing page and bare DOI come last, because they
 * usually redirect to a paywalled or JS-only publisher page.
 *
 * The order only decides what is tried FIRST. The Article Finder falls through
 * the rest when a URL turns out to be an abstract page or blocked — which is
 * the point of returning all of them rather than guessing one.
 */
export function workUrls(w: OpenAlexWork): string[] {
  const oa = w.best_oa_location;
  const otherOpenCopies = (w.locations ?? [])
    .filter((l) => l.is_oa)
    .flatMap((l) => [l.pdf_url, l.landing_page_url]);
  return uniqueFetchable([
    isPdfUrl(oa?.landing_page_url) ? undefined : oa?.landing_page_url,
    oa?.pdf_url,
    oa?.landing_page_url,
    ...otherOpenCopies,
    w.primary_location?.landing_page_url,
    w.doi,
  ]);
}

/** The URL to try first for a work (see {@link workUrls}). */
export function pickWorkUrl(w: OpenAlexWork): string {
  return workUrls(w)[0] ?? "";
}

async function searchOpenAlex(
  query: string,
  fromDate: string | null,
  page: number,
): Promise<CandidateArticle[]> {
  const params = new URLSearchParams({
    search: query,
    "per-page": String(OPENALEX_PER_PAGE),
    page: String(page),
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
    const { url, fullTextUrls } = primaryAndAlternates(workUrls(w));
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
        fullTextUrls,
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
  /** The free PDF, when Semantic Scholar knows of one. `url` is "" for closed papers. */
  openAccessPdf?: { url?: string | null; status?: string | null } | null;
}

/**
 * A Semantic Scholar hit's URLs, full text first. `p.url` is S2's own paper
 * page — an abstract and a link out, never the text — so the open-access PDF
 * leads whenever there is one, and the S2 page is kept only as a last resort.
 */
export function semanticScholarUrls(p: Pick<S2Paper, "url" | "openAccessPdf">): string[] {
  return uniqueFetchable([p.openAccessPdf?.url, p.url]);
}

async function searchSemanticScholar(
  query: string,
  fromDate: string | null,
  page: number,
): Promise<CandidateArticle[]> {
  const params = new URLSearchParams({
    query,
    limit: String(S2_LIMIT),
    offset: String((page - 1) * S2_LIMIT),
    fields: "title,abstract,venue,url,publicationDate,year,citationCount,authors,openAccessPdf",
  });
  if (fromDate) params.set("publicationDateOrYear", `${fromDate}:`);

  // A free key (semanticscholar.org/product/api) lifts the shared anonymous
  // pool's limit. Optional: without it the retry below usually still gets through.
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (!apiKey && Date.now() < s2CooldownUntil) return [];

  let data: { data?: S2Paper[] };
  try {
    data = await withRetry(
      "Semantic Scholar",
      async () => {
        // `openAccessPdf` is a bare flag (no value) that restricts results to
        // papers with a public PDF — the same "only what a debater can actually
        // read" rule OpenAlex gets from open_access.is_oa. Without it, S2 was the
        // main source of abstract-only results: its `url` is its own paper page,
        // never the text. Appended by hand because URLSearchParams would send
        // `openAccessPdf=`.
        const res = await fetch(
          `https://api.semanticscholar.org/graph/v1/paper/search?${params}&openAccessPdf`,
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
      },
      // The keyless pool is shared with every anonymous caller on the internet
      // and was 429ing on every attempt when measured; four attempts only held
      // the whole search up waiting for it.
      apiKey ? 4 : 2,
    );
    s2Consecutive429 = 0;
  } catch (err) {
    if (err instanceof Error && /\b429\b/.test(err.message) && ++s2Consecutive429 >= S2_COOLDOWN_AFTER) {
      s2CooldownUntil = Date.now() + S2_COOLDOWN_MS;
      s2Consecutive429 = 0;
      console.warn("academicSearch: Semantic Scholar keeps rate-limiting; skipping it for 5 minutes");
    }
    throw err;
  }

  return (data.data ?? []).flatMap((p): CandidateArticle[] => {
    const { url, fullTextUrls } = primaryAndAlternates(semanticScholarUrls(p));
    if (!p.title || !url) return [];
    return [
      {
        title: p.title,
        authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
        venue: p.venue ?? "",
        date: p.publicationDate ?? (p.year ? String(p.year) : ""),
        url,
        fullTextUrls,
        abstract: p.abstract ?? "",
        citationCount: p.citationCount ?? 0,
        source: "semanticscholar",
      },
    ];
  });
}

/**
 * Dedupe by normalized title, preferring the hit with the richer abstract.
 *
 * The loser's URLs are kept as full-text alternates: OpenAlex and Semantic
 * Scholar often point the same paper at different copies, and the one that
 * lost on abstract length may be the only one a debater can actually open.
 */
export function dedupeCandidates(candidates: CandidateArticle[]): CandidateArticle[] {
  const byTitle = new Map<string, CandidateArticle>();
  for (const c of candidates) {
    const title = c.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    // A short, generic title ("Introduction", "Editorial", "Book Review") is
    // shared by unrelated works; merging them would hand one paper's URLs to
    // another as its "full text". Those also need the same lead author + year.
    const generic = title.split(" ").length < 4;
    const lead = (c.authors[0] ?? "").toLowerCase().split(/\s+/).pop() ?? "";
    const key = generic ? `${title}|${lead}|${c.date.slice(0, 4)}` : title;
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, c);
      continue;
    }
    const [winner, loser] = c.abstract.length > existing.abstract.length ? [c, existing] : [existing, c];
    const alternates = [
      ...(winner.fullTextUrls ?? []),
      loser.url,
      ...(loser.fullTextUrls ?? []),
    ];
    byTitle.set(key, {
      ...winner,
      fullTextUrls: [...new Set(alternates)].filter((u) => u && u !== winner.url),
    });
  }
  return [...byTitle.values()];
}

export interface AcademicSearchOptions {
  /** 1-based results page — how far down each database's ranking to reach. */
  page?: number;
  /**
   * How many of `queries` also go to Semantic Scholar (the rest go to OpenAlex
   * only). Its keyless pool rate-limits hard, so it gets the raw claim, not
   * every variant.
   */
  semanticScholarQueries?: number;
}

/**
 * One promise per sub-search, each resolving to that sub-search's hits (never
 * rejecting — a failure resolves to []), in a stable order: for each query,
 * OpenAlex then Semantic Scholar.
 *
 * Kept as separate BUCKETS so the Article Finder can interleave them — take the
 * best hit of every query before the second-best of any — and can stop waiting
 * at a deadline with whatever has arrived. Flattening first let the raw claim's
 * 25 OpenAlex hits fill the ranker's whole shortlist, so the other queries were
 * fetched and never ranked.
 */
export function searchAcademicBuckets(
  queries: string[],
  publicationAge: PublicationAge | undefined,
  opts: AcademicSearchOptions = {},
): Array<Promise<CandidateArticle[]>> {
  const fromDate = publicationAgeToFromDate(publicationAge);
  const page = opts.page ?? 1;
  const s2Count = opts.semanticScholarQueries ?? queries.length;
  const quiet = (label: string, p: Promise<CandidateArticle[]>) =>
    p.catch((err: unknown) => {
      console.warn(`academicSearch: ${label} failed`, String(err));
      return [];
    });
  return queries.flatMap((q, i) => [
    quiet("OpenAlex", searchOpenAlex(q, fromDate, page)),
    ...(i < s2Count ? [quiet("Semantic Scholar", searchSemanticScholar(q, fromDate, page))] : []),
  ]);
}

/**
 * Run every query against both databases in parallel and merge the results. A
 * single source failing (rate limit, outage) degrades gracefully instead of
 * failing the search.
 */
export async function searchAcademic(
  queries: string[],
  publicationAge: PublicationAge | undefined,
  opts: AcademicSearchOptions = {},
): Promise<CandidateArticle[]> {
  const buckets = await Promise.all(searchAcademicBuckets(queries, publicationAge, opts));
  return dedupeCandidates(buckets.flat());
}
