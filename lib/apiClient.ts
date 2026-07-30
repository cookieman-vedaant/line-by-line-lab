import type {
  Article,
  AssistantRequest,
  AssistantResult,
  Card,
  CutRequest,
  SearchParams,
} from "@/types";

/** Browser-side helpers for the two API routes; normalize outcomes for the UI. */

/**
 * A stable, anonymous per-browser id (localStorage), sent so the server can
 * rate-limit web searches per person without accounts. Not security — just a
 * fair-use key. Falls back to "" (server then uses IP) if storage is blocked.
 */
function clientId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem("lbl_client");
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.localStorage.setItem("lbl_client", id);
    }
    return id;
  } catch {
    return "";
  }
}

/** JSON headers plus the per-browser client id (when available). */
function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const id = clientId();
  if (id) headers["x-lbl-client"] = id;
  return headers;
}

export type SearchOutcome =
  | { ok: true; articles: Article[] }
  | { ok: true; articles: []; notice: string }
  | { ok: false; error: string };

export async function requestSearch(params: SearchParams): Promise<SearchOutcome> {
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: apiHeaders(),
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

export type AssistantOutcome =
  | { ok: true; result: AssistantResult }
  | { ok: false; error: string };

export async function requestAssistant(req: AssistantRequest): Promise<AssistantOutcome> {
  try {
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(req),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ?? "The coach couldn't respond. Please try again." };
    }
    return { ok: true, result: data };
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
