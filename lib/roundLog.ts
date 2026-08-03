import type { Round } from "@/types";

/**
 * Account-backed storage for the Round Log. Rounds live in the signed-in user's
 * Supabase rows (per-user via RLS) and are reached through `/api/rounds`, so they
 * follow the debater across every device they log into — and stay private to
 * them. This file is the ONLY place the UI touches round storage.
 *
 * Still an external store (subscribe + snapshot) for useSyncExternalStore, but
 * the data now loads ASYNCHRONOUSLY: call `loadRounds()` on mount to fetch from
 * the server once; mutations write through to the API and update the cache.
 */

const EMPTY: Round[] = [];

// getSnapshot must return a STABLE reference until the data actually changes, or
// useSyncExternalStore loops. `cache` only changes in a mutation/load below.
let cache: Round[] = EMPTY;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/** What a caller supplies to log a round (id + createdAt are assigned server-side). */
export type NewRound = Omit<Round, "id" | "createdAt">;

// ---- external store surface ----------------------------------------------

export function subscribeRounds(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Client snapshot — the live list (newest first). Stable until a mutation. */
export function getRoundsSnapshot(): Round[] {
  return cache;
}

/** Server snapshot — always the same empty array (no data on the server). */
export function getRoundsServerSnapshot(): Round[] {
  return EMPTY;
}

/** True once the first server load has finished — drives a loading state. */
export function getRoundsLoadedSnapshot(): boolean {
  return loaded;
}
export function getRoundsLoadedServerSnapshot(): boolean {
  return false;
}

/** Non-reactive read for callers outside React (kept for compatibility). */
export function getRounds(): Round[] {
  return cache;
}

// ---- loading + mutations --------------------------------------------------

/**
 * Fetch the signed-in user's rounds from the server. Idempotent: concurrent
 * callers share one request, and it runs only once unless `force` is set (used
 * after an import to refresh the canonical, ordered list).
 */
export async function loadRounds(force = false): Promise<void> {
  if (loading) return loading;
  if (loaded && !force) return;
  loading = (async () => {
    try {
      /*
       * The server pages results (cursor on created_at) so a single query can
       * never load an unbounded number of rows. We still need the COMPLETE set
       * here, because the Record tab derives career stats and the debater
       * profile from every round — a partial list would silently produce wrong
       * win rates. So: follow the cursor until exhausted.
       *
       * MAX_PAGES bounds the loop. Without it, a bug that kept returning a
       * cursor would spin forever in the browser.
       */
      const MAX_PAGES = 50;
      const all: Round[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < MAX_PAGES; page++) {
        const qs = cursor ? `?limit=200&before=${encodeURIComponent(cursor)}` : "?limit=200";
        const res: Response = await fetch(`/api/rounds${qs}`, {
          headers: { Accept: "application/json" },
        });
        // A non-OK response (e.g. 401 before sign-in) leaves the cache as-is; a
        // later loadRounds(true) after sign-in will populate it.
        if (!res.ok) return;

        const data = (await res.json()) as { rounds?: Round[]; nextCursor?: string | null };
        if (Array.isArray(data.rounds)) all.push(...data.rounds);
        cursor = data.nextCursor ?? null;
        if (!cursor) break;
      }
      cache = all.length > 0 ? all : EMPTY;
    } catch {
      /* offline — keep whatever we have */
    } finally {
      loaded = true;
      loading = null;
      notify();
    }
  })();
  return loading;
}

/** Log a round: POST to the server, then prepend the saved row to the cache. */
export async function addRound(input: NewRound): Promise<SaveResult> {
  try {
    const res = await fetch("/api/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ round: input }),
    });
    const data = (await res.json().catch(() => ({}))) as { round?: Round; error?: string };
    if (!res.ok || !data.round) {
      return { ok: false, error: data.error ?? "Couldn't save your round. Please try again." };
    }
    cache = [data.round, ...cache];
    notify();
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the server. Is it running?" };
  }
}

/** Delete a round: optimistic remove, rolled back if the server rejects it. */
export async function deleteRound(id: string): Promise<SaveResult> {
  const prev = cache;
  cache = cache.filter((r) => r.id !== id);
  notify();
  try {
    const res = await fetch(`/api/rounds?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      cache = prev;
      notify();
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? "Couldn't delete that round." };
    }
    return { ok: true };
  } catch {
    cache = prev;
    notify();
    return { ok: false, error: "Could not reach the server. Is it running?" };
  }
}

/**
 * One-time import of rounds saved on THIS device before the user had an account
 * (old localStorage). Bulk-inserts them, then refetches so the cache matches the
 * server exactly.
 */
export async function importLocalRounds(rounds: NewRound[]): Promise<SaveResult> {
  if (rounds.length === 0) return { ok: true };
  try {
    const res = await fetch("/api/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rounds }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? "Import failed. Please try again." };
    }
    await loadRounds(true);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the server. Is it running?" };
  }
}
