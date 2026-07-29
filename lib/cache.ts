/**
 * A tiny in-memory TTL + LRU cache — the cheapest way to stop spending Gemini
 * quota on identical repeat work (re-running the same search, re-cutting the
 * same article at the same length while iterating). No dependencies, no DB.
 *
 * Caveat: it lives in the server process, so it resets on restart and isn't
 * shared across serverless instances on Vercel. That's fine for personal use —
 * it turns a testing session's repeats into free hits, nothing more.
 */

interface Entry<V> {
  value: V;
  expires: number;
}

export class TtlCache<V> {
  private readonly store = new Map<string, Entry<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 50,
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency for LRU eviction.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.delete(key);
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
    // Evict the oldest entries past the cap (Map preserves insertion order).
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  /** Return the cached value, or compute + store it on a miss. */
  async wrap(key: string, compute: () => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await compute();
    this.set(key, value);
    return value;
  }
}
