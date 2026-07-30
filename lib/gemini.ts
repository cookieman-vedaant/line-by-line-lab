import {
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type ToolListUnion,
} from "@google/genai";
import { extractJson } from "@/lib/json";

// Free-tier friendly default; override with GEMINI_MODEL in .env.local.
// A *flash-lite* model has the most generous free limits and uses fewer tokens
// per call than full flash — the biggest single lever against the "quota hit
// after a couple uses" problem. It's ample for our structured extraction /
// selection / ranking / marking work. gemini-3.1-flash-lite is verified working
// on this key with our config (thinking disabled + JSON output); some newer
// aliases 404 or reject that config. Bump to gemini-3.1-flash (or gemini-2.5-
// flash) via GEMINI_MODEL if card-marking quality ever needs a stronger model.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

// The card-marking call (picking which warrant phrases to underline/highlight)
// is the one quality-critical AI step — a lite model highlights disconnected
// buzzwords. Route just that call to a stronger model; the cheap structural
// calls (expand/select/rank) stay on the lite default above. Verified working
// on this key with our config; override with GEMINI_MARKER_MODEL.
export const GEMINI_MARKER_MODEL =
  process.env.GEMINI_MARKER_MODEL || "gemini-3.5-flash";

// Backoff for transient failures (429 rate limit / 503 overload). Kept short so
// a cut doesn't hang for the better part of a minute on serverless. Callers that
// have a faster fallback (e.g. the marker's fallback model) pass retries: 0.
const RETRY_DELAYS_MS = [3000, 7000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Transient model errors worth retrying: rate limits (429), and — critically —
 * server-side overload (503 "high demand"/UNAVAILABLE) and gateway blips
 * (500/502/504) plus flaky network. These are temporary; a short wait clears
 * them. Anything else (bad request, our bug) fails immediately.
 */
function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|quota|rate.?limit|overloaded|high demand|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(
    err.message,
  );
}

/** Thrown when the server is missing its API key — surfaced as a clean 500. */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "The server isn't configured with a Gemini API key yet. Add GEMINI_API_KEY to .env.local and restart the dev server.",
    );
    this.name = "MissingApiKeyError";
  }
}

/**
 * Thrown when the model is temporarily unavailable — a hit rate limit (429) OR
 * high demand / overload (503). Surfaced as a friendly "try again" hint.
 */
export class RateLimitedError extends Error {
  constructor() {
    super(
      "The AI is busy right now (rate limit or high demand). Wait a few seconds and try again.",
    );
    this.name = "RateLimitedError";
  }
}

let client: GoogleGenAI | null = null;

/** Lazily create the Gemini client. Fails loudly (not silently) without a key. */
export function getGemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new MissingApiKeyError();
  }
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

interface GenerateJsonOptions {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  /** Override the model for this call (defaults to GEMINI_MODEL). */
  model?: string;
  /** Max retry attempts on transient errors (default = RETRY_DELAYS_MS.length).
   *  Pass 0 to fail fast when the caller has its own fallback. */
  retries?: number;
}

/**
 * One Gemini call that must produce JSON. Returns the parsed value, or null
 * if the model's output wasn't parseable — callers decide how to fail honestly.
 */
export async function generateJson(opts: GenerateJsonOptions): Promise<unknown> {
  const ai = getGemini();
  const maxRetries = opts.retries ?? RETRY_DELAYS_MS.length;

  // Try once, then retry on transient errors with backoff. Non-transient errors
  // fail immediately.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: opts.model ?? GEMINI_MODEL,
        contents: opts.prompt,
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: opts.maxOutputTokens ?? 8192,
          // Our calls are structured extraction/selection, not open reasoning.
          // Disabling thinking keeps the whole token budget for the JSON answer
          // (2.5 models otherwise spend it thinking and truncate output), and
          // uses fewer tokens per call — easing free-tier rate limits.
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      return extractJson(response.text ?? "");
    } catch (err) {
      if (!isTransient(err)) throw err;
      if (attempt >= maxRetries) throw new RateLimitedError();
      await sleep(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
    }
  }
}

interface GenerateContentRawOptions {
  system: string;
  /** Full multi-turn conversation (incl. function-response turns). */
  contents: Content[];
  /** Optional function-calling tools. */
  tools?: ToolListUnion;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  retries?: number;
}

/**
 * Lower-level Gemini call for the assistant/agent loop: sends the full `contents`
 * (multi-turn + function-response turns) and optional tools, and returns the raw
 * response so the caller can read `functionCalls` / `text`. Same transient-retry
 * behavior as generateJson (thinking disabled to conserve free-tier tokens).
 */
export async function generateContentRaw(
  opts: GenerateContentRawOptions,
): Promise<GenerateContentResponse> {
  const ai = getGemini();
  const maxRetries = opts.retries ?? RETRY_DELAYS_MS.length;
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.models.generateContent({
        model: opts.model ?? GEMINI_MODEL,
        contents: opts.contents,
        config: {
          systemInstruction: opts.system,
          temperature: opts.temperature ?? 0.3,
          maxOutputTokens: opts.maxOutputTokens ?? 4096,
          thinkingConfig: { thinkingBudget: 0 },
          ...(opts.tools ? { tools: opts.tools } : {}),
        },
      });
    } catch (err) {
      if (!isTransient(err)) throw err;
      if (attempt >= maxRetries) throw new RateLimitedError();
      await sleep(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
    }
  }
}
