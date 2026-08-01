import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Live "who's online" presence, backed by `profiles.last_seen` (Postgres) — the
 * single source of truth shared across EVERY serverless instance.
 *
 * Each signed-in visitor stamps `last_seen` on a ~15s heartbeat; "online" = a row
 * stamped within the window below. Counting from the database (not per-instance
 * memory) is what makes the number correct across DIFFERENT users on Vercel's
 * many instances — an in-memory count only ever sees one instance's own visitors,
 * so two people on two devices would each see "1".
 *
 * The count is read with a service-role client so it can see all rows, but only
 * the NUMBER is ever returned — never who — so no personal data is shared.
 */

// "online" = last_seen within the last 40s. The heartbeat is ~15s, so this
// tolerates one missed beat (tab briefly hidden, a slow request) without flicker.
export const PRESENCE_WINDOW_MS = 40_000;

/**
 * Pure: the ISO timestamp before which a `last_seen` counts as offline. Anything
 * newer than this is "online". Unit-tested.
 */
export function onlineCutoffIso(
  now: number = Date.now(),
  windowMs: number = PRESENCE_WINDOW_MS,
): string {
  return new Date(now - windowMs).toISOString();
}

/**
 * Count users active within the window. `admin` must be a service-role client so
 * it can see all rows (RLS would otherwise restrict a user to their own, making
 * the count always 1). Returns only a number; never throws — on a DB hiccup it
 * returns null and the caller keeps a sensible fallback.
 */
export async function countOnline(
  admin: SupabaseClient,
  now: number = Date.now(),
): Promise<number | null> {
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .gt("last_seen", onlineCutoffIso(now));
  if (error) {
    console.warn("presence count failed", error.message);
    return null;
  }
  return count ?? 0;
}
