import { CUT_ORIGINS, type CutOrigin, type SavedCard, type SavedCardSummary } from "@/types";

/**
 * Pure mappers between the Supabase `cut_cards` row (snake_case, nullable) and
 * the app's `SavedCard` domain type (camelCase, non-null). Kept out of the route
 * handler so the mapping can be unit-tested without a server or a database —
 * same split as lib/roundMap.
 */

/** A list row from `cut_cards` — no body, no citation details. */
export interface CutCardListRow {
  id: string;
  tag: string | null;
  cite: string | null;
  claim: string | null;
  card_length: string | null;
  origin: string | null;
  source_url: string | null;
  source_title: string | null;
  source_publication: string | null;
  created_at: string;
}

/** A full row, for one card being opened. */
export interface CutCardRow extends CutCardListRow {
  cite_details: string | null;
  body: string | null;
}

/**
 * Columns for the LIST. Note what is missing: `body` and `cite_details`.
 *
 * A measured cut-card body averages ~20KB (an Entire Article cut is larger
 * still), while everything a list row displays comes to ~200 bytes. Selecting
 * bodies here made one 50-row page a ~1MB transfer to render text no row shows,
 * and it grew with the length of what people cut rather than with how many cards
 * they had. The body is fetched per card, on open — see CUT_CARD_FULL_COLUMNS.
 */
export const CUT_CARD_LIST_COLUMNS =
  "id,tag,cite,claim,card_length,origin,source_url,source_title,source_publication,created_at";

/** Columns for ONE card, opened to be read: the list fields plus the heavy two. */
export const CUT_CARD_FULL_COLUMNS = `${CUT_CARD_LIST_COLUMNS},cite_details,body`;

function toOrigin(value: string | null): CutOrigin {
  // An unrecognised origin means a newer server wrote a value this build doesn't
  // know yet. Fall back rather than throwing: a history that refuses to render
  // is worse than one that mislabels where a card came from.
  return (CUT_ORIGINS as readonly string[]).includes(value ?? "")
    ? (value as CutOrigin)
    : "cutter";
}

/** Empty string, not undefined, for optional text — so `?? ""` isn't needed at
 *  every call site and a missing publication renders as nothing rather than
 *  "undefined". */
function optional(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** DB list row → app `SavedCardSummary`. */
export function rowToCardSummary(row: CutCardListRow): SavedCardSummary {
  return {
    id: row.id,
    tag: row.tag ?? "",
    cite: row.cite ?? "",
    claim: row.claim ?? "",
    cardLength: row.card_length ?? "",
    origin: toOrigin(row.origin),
    sourceUrl: optional(row.source_url),
    sourceTitle: optional(row.source_title),
    sourcePublication: optional(row.source_publication),
    createdAt: row.created_at,
  };
}

/** DB full row → app `SavedCard`, for a card being opened. */
export function rowToSavedCard(row: CutCardRow): SavedCard {
  return {
    ...rowToCardSummary(row),
    citeDetails: row.cite_details ?? "",
    body: row.body ?? "",
  };
}

/**
 * Does this saved card match a free-text filter? Matches the tag, the cite, the
 * claim it was cut for, and the source title — the four things a debater
 * actually remembers about a card. NOT the body: a full-text scan of every body
 * in the browser would match on incidental words and turn a precise filter into
 * noise, which is the same mistake the wiki search had to be rescued from.
 */
export function matchesQuery(card: SavedCardSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [card.tag, card.cite, card.claim, card.sourceTitle ?? ""].some((field) =>
    field.toLowerCase().includes(q),
  );
}
