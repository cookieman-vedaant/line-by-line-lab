import { createSharedCache } from "@/lib/sharedCache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeQuery } from "@/services/caselist";
import type { Card, WikiCardResult, WikiCaselist, WikiSearchResult } from "@/types";

/**
 * Wiki search — query our own index of opencaselist's disclosed cards.
 *
 * opencaselist has no whole-wiki search: its own website searches ONE caselist
 * at a time, and its API caps searches at 4/minute. So we don't query it live.
 * `services/wikiIngest.ts` pulls opencaselist's weekly zip archives into our
 * `wiki_cards` table (Postgres full-text), and this searches THAT — instant,
 * complete, every caselist and year at once, with no per-user login.
 *
 * Nothing here is generated. The query is a pure normalization of the user's
 * words; ranking is Postgres's; every card shown is verbatim disclosed content.
 */

/** Rows returned by the `search_wiki_cards` RPC (the wiki_cards columns we use). */
interface WikiCardRow {
  tag: string;
  cite: string | null;
  cite_details: string | null;
  body: string;
  caselist: string | null;
  year: number | null;
  school: string | null;
  team: string | null;
  source_url: string | null;
}

/**
 * The index is one shared public corpus — the same query returns the same rows
 * for everyone — so the cache is safely pooled across users (unlike the old
 * per-user live search). Short TTL keeps freshly-ingested cards visible soon.
 */
const searchCache = createSharedCache<WikiSearchResult>({
  ttlMs: 10 * 60 * 1000,
  namespace: "wiki-index",
  shareAcrossInstances: true,
});

/**
 * Result cap. Deliberately unchanged while bodies ride along in the search
 * response: cards average 28-46 KB, so this is already a ~2.8 MB payload and
 * 100 measured at 4.6 MB. Raising it would push cold queries past the 8 s
 * statement timeout — the opposite of making prep findable. The way to raise it
 * is to return a light list and load bodies on demand, as cut_cards does.
 */
const MAX_RESULTS = 60;

/** More than this and the debater is not filtering, they are searching everything. */
const MAX_CASELIST_FILTERS = 13;

/** Caselists change only when a new one is first ingested — cache them hard. */
const caselistCache = createSharedCache<WikiCaselist[]>({
  ttlMs: 6 * 60 * 60 * 1000,
  namespace: "wiki-caselists",
  shareAcrossInstances: true,
});

/**
 * Normalize a claim into a search string.
 *
 * `websearch_to_tsquery` (used by the RPC) already handles natural language —
 * it drops stopwords and never errors on punctuation — so this only has to
 * strip our internal emphasis delimiters and collapse whitespace.
 * `sanitizeQuery` does exactly that.
 */
export function buildWikiQuery(claim: string): string {
  return sanitizeQuery(claim);
}

function rowToCardResult(row: WikiCardRow): WikiCardResult {
  const card: Card = {
    tag: row.tag,
    cite: row.cite ?? "",
    citeDetails: row.cite_details ?? "",
    body: row.body,
  };
  return {
    card,
    caselist: row.caselist,
    year: row.year,
    school: row.school,
    team: row.team,
    sourceUrl: row.source_url,
  };
}

/**
 * The caselists in the index, largest first, for the search filter.
 *
 * Read from the table rather than hardcoded: the index grows as ingestion runs,
 * and a stale list would offer filters that match nothing. Cached hard because
 * it changes only when a caselist is first ingested.
 */
export async function listWikiCaselists(): Promise<WikiCaselist[]> {
  return caselistCache.wrap("all", async () => {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("wiki_caselists");
    if (error) {
      console.error("wikiMining: caselist listing failed", error);
      return [];
    }
    const rows = Array.isArray(data) ? (data as Array<{ caselist: string; cards: number }>) : [];
    return rows
      .filter((r) => typeof r.caselist === "string" && r.caselist.length > 0)
      .map((r) => ({ caselist: r.caselist, cards: Number(r.cards) || 0 }));
  });
}

/** Normalize the caller's filter into something safe to hand the RPC. */
function cleanCaselists(caselists: string[] | undefined): string[] {
  if (!Array.isArray(caselists)) return [];
  const seen = new Set<string>();
  for (const raw of caselists) {
    if (typeof raw !== "string") continue;
    // opencaselist slugs are plain lowercase alphanumerics (hsld25, ndtceda24).
    // Anything else is not a caselist we hold, so it is dropped rather than
    // passed through to the query.
    const slug = raw.trim().toLowerCase();
    if (/^[a-z][a-z0-9]{2,31}$/.test(slug)) seen.add(slug);
    if (seen.size >= MAX_CASELIST_FILTERS) break;
  }
  return [...seen].sort();
}

/**
 * Search the indexed wiki for cards matching a claim, optionally restricted to
 * particular caselists.
 *
 * One database query, no rate limit and no opencaselist login. The filter
 * matters more than it looks: a search returns at most MAX_RESULTS cards out of
 * 200k+, so on a broad claim those slots get spent on whichever division ranked
 * highest overall. Narrowing to the debater's own caselist spends them on prep
 * they can actually read — and is much faster, because the caselist index
 * shrinks the corpus before ranking (measured: 7.9s unfiltered -> 0.7s).
 */
export async function searchPrep(
  claim: string,
  caselists?: string[],
): Promise<WikiSearchResult> {
  const query = buildWikiQuery(claim);
  if (query.length < 2) {
    return {
      query: "",
      cards: [],
      notice: "Describe the argument you're looking for.",
    };
  }

  const filter = cleanCaselists(caselists);

  return searchCache.wrap(
    // The filter is part of the identity of the result. Without it in the key,
    // the first search for a claim would be served to everyone who later
    // searched the same claim under a DIFFERENT caselist.
    [query.toLowerCase(), ...filter].join("|"),
    async () => {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.rpc("search_wiki_cards", {
        q: query,
        lim: MAX_RESULTS,
        caselists: filter.length > 0 ? filter : null,
      });
      if (error) {
        console.error("wikiMining: index search failed", error);
        throw new Error("Wiki search is temporarily unavailable. Please try again.");
      }

      const rows = Array.isArray(data) ? (data as WikiCardRow[]) : [];
      const cards = rows.map(rowToCardResult);

      return {
        query,
        cards,
        notice:
          cards.length === 0
            ? "No cards match that yet. Try different wording — the index is still growing, so some prep may not be in it."
            : undefined,
      };
    },
    // Never cache an empty result: the index fills in the background, so "no
    // matches" is only true for this moment. Caching it would keep hiding cards
    // that land seconds later (exactly the "0 cards after ingest" confusion).
    (result) => result.cards.length > 0,
  );
}
