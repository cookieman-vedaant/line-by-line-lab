import type { Round } from "@/types";

/**
 * Local-first storage for the Round Log. Rounds live in the browser under
 * `lbl-rounds` — no account, instant use, $0. This file is the ONLY place that
 * touches storage, so a future login layer can swap these internals for a synced
 * per-user backend (e.g. Supabase) without changing the UI.
 *
 * Exposed as an external store (subscribe + snapshot) so components read it with
 * useSyncExternalStore: SSR-safe (stable empty server snapshot) and reactive —
 * a mutation anywhere re-renders every reader.
 */

const KEY = "lbl-rounds";
const EMPTY: Round[] = [];

// Cached snapshot: getSnapshot must return a STABLE reference until the data
// actually changes, or useSyncExternalStore loops. `cache` only changes in commit().
let cache: Round[] | null = null;
const listeners = new Set<() => void>();

function load(): Round[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Round[]) : [];
  } catch {
    return EMPTY;
  }
}

function commit(next: Round[]): void {
  cache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage disabled / full — the round just won't persist this session */
    }
  }
  listeners.forEach((l) => l());
}

// ---- external store surface ----------------------------------------------

export function subscribeRounds(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Client snapshot — the live list (newest first). Stable until a mutation. */
export function getRoundsSnapshot(): Round[] {
  if (cache === null) cache = load();
  return cache;
}

/** Server snapshot — always the same empty array (no localStorage on the server). */
export function getRoundsServerSnapshot(): Round[] {
  return EMPTY;
}

/** Non-reactive read for callers outside React (e.g. building Coach context). */
export function getRounds(): Round[] {
  return getRoundsSnapshot();
}

// ---- mutations ------------------------------------------------------------

/** What a caller supplies to log a round (id + createdAt are assigned here). */
export type NewRound = Omit<Round, "id" | "createdAt">;

export function addRound(input: NewRound): void {
  const round: Round = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  commit([round, ...getRoundsSnapshot()]);
}

export function deleteRound(id: string): void {
  commit(getRoundsSnapshot().filter((r) => r.id !== id));
}

export function clearRounds(): void {
  commit([]);
}
