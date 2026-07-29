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
  source: "openalex" | "semanticscholar";
}

const FETCH_TIMEOUT_MS = 10000;

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
  authorships?: { author?: { display_name?: string } }[];
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
    "per-page": "12",
    sort: "relevance_score:desc",
  });
  const filters = ["has_abstract:true"];
  if (fromDate) filters.push(`from_publication_date:${fromDate}`);
  params.set("filter", filters.join(","));

  const res = await fetch(`https://api.openalex.org/works?${params}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OpenAlex responded ${res.status}`);
  const data: { results?: OpenAlexWork[] } = await res.json();

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

  const res = await fetch(
    `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`Semantic Scholar responded ${res.status}`);
  const data: { data?: S2Paper[] } = await res.json();

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
