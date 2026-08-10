import type { SavedCard } from "@/types";

/**
 * Client access to the account's card-cut history (`/api/cards`). The ONLY place
 * the UI touches card-history storage.
 *
 * Deliberately NOT an external store like lib/roundLog. Rounds are read by three
 * tabs at once and have to stay in lockstep; history is read by exactly one
 * panel, and card bodies are kilobytes each — holding every page in a module
 * singleton would keep that memory alive for the whole session for no reader.
 * The panel owns its own state and pages on demand.
 *
 * There is no `add` here on purpose: rows are written server-side by /api/cut,
 * so a card can never be in your history unless the Card Cutter actually
 * produced it.
 */

export interface HistoryPage {
  cards: SavedCard[];
  /** Pass back as `before` to get the next page; null means the end. */
  nextCursor: string | null;
}

export type HistoryOutcome =
  | { ok: true; page: HistoryPage }
  | { ok: false; error: string };

export type DeleteOutcome = { ok: true } | { ok: false; error: string };

/** One page of history, newest first. `before` is the previous page's cursor. */
export async function fetchCardHistory(before?: string | null): Promise<HistoryOutcome> {
  try {
    const qs = before ? `?before=${encodeURIComponent(before)}` : "";
    const res = await fetch(`/api/cards${qs}`, { headers: { Accept: "application/json" } });
    const data = (await res.json()) as {
      cards?: SavedCard[];
      nextCursor?: string | null;
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Couldn't load your card history." };
    }
    return {
      ok: true,
      page: { cards: data.cards ?? [], nextCursor: data.nextCursor ?? null },
    };
  } catch {
    return { ok: false, error: "You appear to be offline. Check your connection and try again." };
  }
}

/** Permanently remove one saved card. */
export async function deleteCardFromHistory(id: string): Promise<DeleteOutcome> {
  try {
    const res = await fetch(`/api/cards?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? "Couldn't delete that card." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "You appear to be offline. Check your connection and try again." };
  }
}
