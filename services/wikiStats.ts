import "server-only";
import { cacheLife } from "next/cache";
import { createSharedCache } from "@/lib/sharedCache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * How many disclosed cards are actually in the index right now.
 *
 * This exists so the landing page can state a real figure instead of a
 * marketing one. The no-fabrication rule that governs evidence governs our own
 * claims too: the number shown is READ FROM THE DATABASE and ROUNDED DOWN, so
 * it is always an understatement, never a promise the index can't keep. It
 * moves on its own as ingestion runs — nobody has to remember to edit a
 * hardcoded string, which is exactly how a number like this goes stale and
 * quietly becomes a lie.
 *
 * The service_role client is required because the landing page is public and
 * `wiki_cards` is readable only by authenticated users. Only the COUNT leaves
 * the server — never a row.
 */

/** Floor to a clean thousand, so the displayed figure is never an overstatement. */
export function roundDownToThousand(count: number): number {
  return Math.floor(count / 1000) * 1000;
}

/**
 * Below this the stat reads as a weakness rather than a strength ("2,000+
 * cards"), and mid-backfill it would be actively misleading. Under it, the
 * caller falls back to the static capability stats.
 */
const MIN_SHOWABLE = 10_000;

/**
 * Indexed card count, rounded down — or null when it can't be trusted.
 *
 * Cached for an hour, AND uses an ESTIMATED count, not `exact`. An exact
 * `count(*)` is a full scan of the whole index (90k+ rows and climbing) — real
 * read IO that, during a heavy ingest, contends with the write bursts and made
 * this stat slow enough to hold up the whole landing render. `estimated` reads
 * the planner's row estimate (pg_class.reltuples) instead: effectively instant,
 * zero scan. It can lag the true count slightly between autovacuum runs, but
 * this figure is already floored to a clean thousand and framed as a deliberate
 * understatement — a number that's a little low is exactly the safe direction.
 *
 * Returning null on ANY failure is deliberate — a landing page that fails to
 * render because a stat query hiccuped would be a far worse bug than a missing
 * stat.
 */
export async function getIndexedCardCount(): Promise<number | null> {
  "use cache";
  cacheLife("hours");

  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin
      .from("wiki_cards")
      .select("*", { count: "estimated", head: true });

    if (error || count == null) return null;
    const rounded = roundDownToThousand(count);
    return rounded >= MIN_SHOWABLE ? rounded : null;
  } catch {
    // No keys at build time, network failure, timeout — all mean "no stat".
    return null;
  }
}

export interface WireItem {
  /** A real disclosed card's tag — the argument — cleaned and length-capped. */
  tag: string;
  /** Division + year, e.g. "LD 2025". Deliberately NOT school or team. */
  division: string;
}

/** `hsld25` → "LD 2025", `hspolicy24` → "Policy 2024". Division + year only. */
function divisionLabel(caselist: string): string {
  const m = caselist.match(/^([a-z]+?)(\d{2})$/i);
  const key = (m ? m[1] : caselist).toLowerCase();
  const year = m ? `20${m[2]}` : "";
  const name =
    key === "hsld"
      ? "LD"
      : key === "hspf"
        ? "PF"
        : key === "hspolicy"
          ? "Policy"
          : key === "ndtceda"
            ? "College Policy"
            : key === "nfald"
              ? "College LD"
              : key.toUpperCase();
  return year ? `${name} ${year}` : name;
}

/**
 * A curated sample of REAL disclosed card tags for the landing "Wire" ticker
 * (components/marketing/Wire.tsx). Nothing here is generated — every tag is an
 * argument a real team disclosed, read straight from the index; the ticker just
 * makes the "X,000+ cards" figure tangible and proves the Wiki tool.
 *
 * Only the tag and its division/year are returned (see the `wire_tags` SQL
 * function) — never a school, team, or body — so the public page attributes no
 * one. Cached for an hour: it's marketing, not live data, and the SQL samples
 * ~2% of rows rather than scanning, so it never adds meaningful read IO.
 */
// Cached for an hour, but through the shared cache (not `"use cache"`) so we can
// REFUSE to memoize a failure. `"use cache"` caches whatever it returns, which
// meant a DB timeout returned [] and blanked the Wire for a full hour even after
// the database recovered. Now an empty/thin result is never cached — the next
// visit just retries.
const wireCache = createSharedCache<WireItem[]>({
  ttlMs: 60 * 60 * 1000,
  namespace: "wire-tags",
});

export async function getWireTags(): Promise<WireItem[]> {
  return wireCache.wrap(
    "landing",
    async () => {
      try {
        const admin = createSupabaseAdminClient();
        const { data, error } = await admin.rpc("wire_tags", { lim: 40 });
        if (error || !Array.isArray(data)) return [];

        const seen = new Set<string>();
        const items: WireItem[] = [];
        for (const row of data as Array<{ tag?: unknown; caselist?: unknown }>) {
          if (typeof row.tag !== "string" || typeof row.caselist !== "string") continue;
          const tag = row.tag.replace(/\s+/g, " ").trim();
          if (tag.length < 28) continue;
          const key = tag.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({
            tag: tag.length > 96 ? `${tag.slice(0, 96).trimEnd()}…` : tag,
            division: divisionLabel(row.caselist),
          });
          if (items.length >= 26) break;
        }
        return items;
      } catch {
        return [];
      }
    },
    // Never memoize a thin/failed set — an outage or a mid-backfill hiccup must
    // not blank the Wire for the whole TTL. Only a real, full result is cached.
    (items) => items.length >= 8,
  );
}
