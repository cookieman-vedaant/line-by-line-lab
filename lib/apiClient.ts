import type {
  Article,
  AssistantRequest,
  AssistantResult,
  Card,
  CutRequest,
  DebaterProfile,
  RehighlightRequest,
  RehighlightResult,
  Round,
  SearchParams,
  ThemeSpec,
  WikiSearchRequest,
  WikiSearchResult,
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

/** Send a presence heartbeat; returns the live online count, or null on failure. */
export async function pingPresence(): Promise<number | null> {
  try {
    const res = await fetch("/api/presence", { method: "POST", headers: apiHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.count === "number" ? data.count : null;
  } catch {
    return null;
  }
}

export type VerifyHumanOutcome = { ok: true; ttlMs: number } | { ok: false; error: string };

/** Send a solved Turnstile token; on success the server sets the human cookie. */
export async function verifyHuman(token: string): Promise<VerifyHumanOutcome> {
  try {
    const res = await fetch("/api/verify-human", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? "Verification failed. Try again." };
    }
    return { ok: true, ttlMs: data.ttlMs ?? 2 * 60 * 60 * 1000 };
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

export type RehighlightOutcome =
  | { ok: true; result: RehighlightResult }
  | { ok: false; error: string };

/** Re-highlight an opponent's card against its own source. */
export async function requestRehighlight(req: RehighlightRequest): Promise<RehighlightOutcome> {
  try {
    const res = await fetch("/api/rehighlight", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(req),
    });
    const data = await res.json();
    if (!res.ok || !data.result) {
      return {
        ok: false,
        error: data.error ?? "Re-highlight failed. Try another card or paste the article URL.",
      };
    }
    return { ok: true, result: data.result };
  } catch {
    return { ok: false, error: "Could not reach the server. Is it running?" };
  }
}

export type WikiSearchOutcome =
  | { ok: true; result: WikiSearchResult }
  | { ok: false; error: string };

/** Search our indexed copy of the wiki for disclosed cards matching a claim. */
export async function requestWikiSearch(req: WikiSearchRequest): Promise<WikiSearchOutcome> {
  try {
    const res = await fetch("/api/wiki/search", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(req),
    });
    const data = await res.json();
    if (!res.ok || !data.result) {
      return { ok: false, error: data.error ?? "That search didn't go through. Try again." };
    }
    return { ok: true, result: data.result };
  } catch {
    return { ok: false, error: "Could not reach the server. Is it running?" };
  }
}

export interface FeedbackInput {
  kind: "bug" | "idea" | "other";
  message: string;
  page?: string;
  contactEmail?: string;
}

export type FeedbackOutcome = { ok: true } | { ok: false; error: string };

/** Send an in-app bug report / idea. */
export async function submitFeedback(input: FeedbackInput): Promise<FeedbackOutcome> {
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Couldn't send that. Please try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}

/**
 * Preflight before a browser auth call (sign-up / resend / reset). Those calls go
 * straight from the browser to Supabase, so this is our only chance to apply
 * per-email and per-IP limits and to record the attempt.
 *
 * Fails OPEN on a network error: if our own limiter is unreachable, that must not
 * stop a legitimate person from signing in. Supabase's own rate limits and
 * CAPTCHA still apply on the call itself.
 */
export async function checkAuthAttempt(
  kind: "signup" | "resend" | "reset",
  email: string,
): Promise<FeedbackOutcome> {
  try {
    const res = await fetch("/api/auth-attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, email }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? "Too many attempts. Please try again later." };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/** Permanently delete the signed-in account and all data attached to it. */
export async function deleteAccount(): Promise<FeedbackOutcome> {
  try {
    const res = await fetch("/api/account", { method: "DELETE", headers: apiHeaders() });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Couldn't delete the account. Please try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}
