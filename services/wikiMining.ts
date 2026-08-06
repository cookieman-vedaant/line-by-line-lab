import { createSharedCache } from "@/lib/sharedCache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeQuery } from "@/services/caselist";
import type { Card, WikiCardResult, WikiSearchResult } from "@/types";

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

const MAX_RESULTS = 60;

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
 * Search the whole indexed wiki for cards matching a claim.
 *
 * One database query. No caselist to choose, no rate limit, no opencaselist
 * login — the debater describes the argument and gets matching cards from every
 * caselist and year we've indexed.
 */
export async function searchPrep(claim: string): Promise<WikiSearchResult> {
  const query = buildWikiQuery(claim);
  if (query.length < 2) {
    return {
      query: "",
      cards: [],
      notice: "Describe the argument you're looking for.",
    };
  }

  return searchCache.wrap(
    query.toLowerCase(),
    async () => {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.rpc("search_wiki_cards", { q: query, lim: MAX_RESULTS });
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
