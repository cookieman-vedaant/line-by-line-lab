import type { Round } from "@/types";

/**
 * Pure mappers between the Supabase `rounds` row (snake_case, nullable columns)
 * and the app's `Round` domain type (camelCase, non-null). Kept separate from
 * the route handler so the mapping can be unit-tested without a server.
 */

/** A row as it comes back from the `rounds` table. */
export interface RoundRow {
  id: string;
  tournament: string | null;
  round_label: string | null;
  side: string | null;
  result: string | null;
  opponent: string | null;
  report: string | null;
  created_at: string;
}

/** DB row → app `Round`. Unknown side/result default to the safe common value. */
export function rowToRound(row: RoundRow): Round {
  return {
    id: row.id,
    tournament: row.tournament ?? "",
    roundLabel: row.round_label ?? "",
    side: row.side === "Neg" ? "Neg" : "Aff",
    result: row.result === "L" ? "L" : "W",
    opponent: row.opponent ?? undefined,
    report: row.report ?? "",
    createdAt: row.created_at,
  };
}
