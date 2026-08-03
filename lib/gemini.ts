import {
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type ToolListUnion,
} from "@google/genai";
import { CircuitOpenError, withBreaker } from "@/lib/circuitBreaker";
import { throttleGemini } from "@/lib/geminiThrottle";
import { extractJson } from "@/lib/json";

// NOTE: per-task, per-tier model selection now lives in lib/models.ts
// (`modelFor(task, tier)`). The two constants below remain the DEFAULTS used
// when a caller doesn't pass an explicit model, and are still honored as
// `GEMINI_MODEL` / `GEMINI_MARKER_MODEL` env overrides so existing deployments
// keep working unchanged.
//
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

// Add jitter so many clients retrying after a shared 429 don't thunder-herd.
const withJitter = (ms: number): number => ms + Math.floor(Math.random() * 1000);

// In-process concurrency gate: cap simultaneous Gemini calls PER INSTANCE so a
// burst of users can't fire a dozen requests at once (which 429s the shared
// free key). Overflow waits for a slot; the slot is released during retry
// backoff so waiters get a turn. Env-tunable. (Cross-instance smoothing is the
// Redis throttle in Tier 2.)
const MAX_CONCURRENCY = (() => {
  const n = Number(process.env.GEMINI_MAX_CONCURRENCY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4;
})();

let activeCalls = 0;
const slotQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeCalls < MAX_CONCURRENCY) {
    activeCalls += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => slotQueue.push(resolve));
}

function releaseSlot(): void {
  const next = slotQueue.shift();
  if (next) next(); // hand the slot straight to a waiter — active count unchanged
  else activeCalls -= 1;
}

/** Run one Gemini API call while holding a concurrency slot. */
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

/**
 * Run a Gemini call behind the circuit breaker. When Gemini is genuinely down,
 * the retry ladder below would otherwise make every single request wait its full
 * ~10s of backoff before failing — slow for the user and needless load on a
 * provider that's already struggling. The breaker short-circuits that after a
 * run of failures and probes periodically to notice recovery.
 *
 * Only TRANSIENT errors count against it: a 400 from a malformed prompt is our
 * bug, not an outage, and letting it open the circuit would take the AI offline
 * for every user over one bad request.
 */
function withGeminiBreaker<T>(fn: () => Promise<T>): Promise<T> {
  return withBreaker("gemini", fn, isTransient);
}

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
  /** Override the model for this call (defaults to GEMINI_MODEL).
   *  Prefer `modelFor(task, tier)` from lib/models.ts over a literal. */
  model?: string;
  /** Thinking budget. Defaults to 0 (disabled) — correct for JSON, since a
   *  thinking model with a small output cap spends the budget reasoning and
   *  truncates the JSON. Only raise it for free-text output. */
  thinkingBudget?: number;
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
      await throttleGemini();
      const response = await withGeminiBreaker(() =>
        withSlot(() =>
          ai.models.generateContent({
            model: opts.model ?? GEMINI_MODEL,
            contents: opts.prompt,
            config: {
              systemInstruction: opts.system,
              responseMimeType: "application/json",
              temperature: 0.2,
              maxOutputTokens: opts.maxOutputTokens ?? 8192,
              // Default 0: these calls are structured extraction/selection, not
              // open reasoning, and a thinking model with a small output cap
              // spends the budget reasoning and truncates the JSON (this is what
              // silently broke the card-length selector once). Callers doing real
              // reasoning can opt in.
              thinkingConfig: { thinkingBudget: opts.thinkingBudget ?? 0 },
            },
          }),
        ),
      );
      return extractJson(response.text ?? "");
    } catch (err) {
      // An open circuit means Gemini is already known-down; retrying here would
      // just re-throw instantly in a loop. Surface the friendly message now.
      if (err instanceof CircuitOpenError) throw new RateLimitedError();
      if (!isTransient(err)) throw err;
      if (attempt >= maxRetries) throw new RateLimitedError();
      await sleep(withJitter(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]));
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
  /** Thinking budget. Unlike generateJson, raising this is often RIGHT here —
   *  the assistant's output is prose with no fragile structure to truncate, and
   *  reasoning is the actual product. */
  thinkingBudget?: number;
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
      await throttleGemini();
      return await withGeminiBreaker(() =>
        withSlot(() =>
          ai.models.generateContent({
            model: opts.model ?? GEMINI_MODEL,
            contents: opts.contents,
            config: {
              systemInstruction: opts.system,
              temperature: opts.temperature ?? 0.3,
              maxOutputTokens: opts.maxOutputTokens ?? 4096,
              thinkingConfig: { thinkingBudget: opts.thinkingBudget ?? 0 },
              ...(opts.tools ? { tools: opts.tools } : {}),
            },
          }),
        ),
      );
    } catch (err) {
      if (err instanceof CircuitOpenError) throw new RateLimitedError();
      if (!isTransient(err)) throw err;
      if (attempt >= maxRetries) throw new RateLimitedError();
      await sleep(withJitter(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]));
    }
  }
}
