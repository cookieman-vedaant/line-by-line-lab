import type {
  Article,
  AssistantRequest,
  AssistantResult,
  Card,
  CutRequest,
  DebaterProfile,
  Round,
  SearchParams,
  ThemeSpec,
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

export type PdfOutcome =
  | { ok: true; text: string; pages: number; truncated: boolean }
  | { ok: false; error: string };

/** Upload a PDF for server-side text extraction (the Coach's "scan my case"). */
export async function extractPdf(file: File): Promise<PdfOutcome> {
  try {
    const form = new FormData();
    form.append("file", file);
    // No Content-Type header — the browser sets the multipart boundary itself.
    const res = await fetch("/api/pdf", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Couldn't read that PDF. Try another file." };
    }
    return { ok: true, text: data.text, pages: data.pages, truncated: data.truncated };
  } catch {
    return { ok: false, error: "Could not reach the server. Is it running?" };
  }
}

export type ThemeOutcome = { ok: true; spec: ThemeSpec } | { ok: false; error: string };

/** Ask the theme agent to design a ThemeSpec from a short vibe. */
export async function requestTheme(prompt: string): Promise<ThemeOutcome> {
  try {
    const res = await fetch("/api/theme", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (!res.ok || !data.spec) {
      return { ok: false, error: data.error ?? "Theme design failed. Try again." };
    }
    return { ok: true, spec: data.spec };
  } catch {
    return { ok: false, error: "Could not reach the server. Is it running?" };
  }
}

export type ProfileOutcome = { ok: true; profile: DebaterProfile } | { ok: false; error: string };

/**
 * Send the debater's own rounds to be analyzed into a profile. The rounds come
 * from localStorage; the endpoint is stateless (stores nothing), and the result
 * is cached locally per device — personal data never becomes shared.
 */
export async function requestProfile(rounds: Round[]): Promise<ProfileOutcome> {
  try {
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ rounds }),
    });
    const data = await res.json();
    if (!res.ok || !data.profile) {
      return { ok: false, error: data.error ?? "Couldn't build your profile. Try again." };
    }
    return { ok: true, profile: data.profile };
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
