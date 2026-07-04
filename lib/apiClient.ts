import type { Article, Card, CutRequest, SearchParams } from "@/types";

/** Browser-side helpers for the two API routes; normalize outcomes for the UI. */

export type SearchOutcome =
  | { ok: true; articles: Article[] }
  | { ok: true; articles: []; notice: string }
  | { ok: false; error: string };

export async function requestSearch(params: SearchParams): Promise<SearchOutcome> {
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Search failed. Please try again." };
    }
    if (!data.articles || data.articles.length === 0) {
      return {
        ok: true,
        articles: [],
        notice: data.notice ?? "No reputable sources were found matching your criteria.",
      };
    }
    return { ok: true, articles: data.articles };
  } catch {
    return { ok: false, error: "Could not reach the server. Is it running?" };
  }
}

export type CutOutcome = { ok: true; card: Card } | { ok: false; error: string };

export async function requestCut(req: CutRequest): Promise<CutOutcome> {
  try {
    const res = await fetch("/api/cut", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    const data = await res.json();
    if (!res.ok || !data.card) {
      return { ok: false, error: data.error ?? "Card cutting failed. Try another article." };
    }
    return { ok: true, card: data.card };
  } catch {
    return { ok: false, error: "Could not reach the server. Is it running?" };
  }
}
