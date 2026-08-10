import {
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type ToolListUnion,
} from "@google/genai";
import { CircuitOpenError, withBreaker } from "@/lib/circuitBreaker";
import { throttleGemini } from "@/lib/geminiThrottle";
import { extractJson } from "@/lib/json";
import {
  claimModelAttempt,
  markModelAvailable,
  markModelExhausted,
} from "@/lib/modelAvailability";

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
 *
 * ── THE BREAKER IS KEYED PER MODEL, AND MUST STAY THAT WAY ──────────────────
 * It used to be one breaker named "gemini" for every model, which produced a
 * genuinely bad failure: `gemini-3.5-flash` is capped at 20 requests/DAY on the
 * free tier, one card cut fires eight marker calls at it, and eight failures
 * blew past the threshold of five — opening the circuit for EVERY model. The
 * Article Finder, which runs entirely on the healthy cheap model, went down as
 * collateral damage, and the marker's own fallback to that same cheap model was
 * unreachable because it had to pass through the circuit it had just opened.
 * One exhausted model must never be able to take a healthy one offline.
 */
function withGeminiBreaker<T>(model: string, fn: () => Promise<T>): Promise<T> {
  return withBreaker(`gemini:${model}`, fn, countsAgainstBreaker);
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

/**
 * A DAILY quota exhaustion, which `isTransient` alone can't distinguish from an
 * ordinary rate limit — both are 429s mentioning "quota". Google names the
 * violated quota in the error body, so read the name rather than guess:
 *
 *   GenerateRequestsPerDayPerProjectPerModel-FreeTier   <- resets tomorrow
 *   GenerateRequestsPerMinutePerProjectPerModel-...     <- resets in seconds
 *
 * Note the per-day error still advertises a `retryDelay` of ~25s, so that field
 * is actively misleading here and is deliberately not consulted.
 *
 * Matching conservatively is safe: an unrecognized 429 simply falls through to
 * the existing retry-and-breaker path, which is what happened before this
 * existed.
 */
export function isDailyQuotaExhausted(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (!/\b429\b|RESOURCE_EXHAUSTED/i.test(err.message)) return false;
  return /PerDayPerProject|RequestsPerDay|per[\s-]?day/i.test(err.message);
}

/**
 * What the breaker is allowed to count. Running out of a per-day allowance is a
 * fact about our BILLING PLAN, not about whether Gemini is reachable — counting
 * it would trip a breaker that no amount of provider recovery can reset.
 */
function countsAgainstBreaker(err: unknown): boolean {
  return isTransient(err) && !isDailyQuotaExhausted(err);
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
  constructor(cause?: unknown) {
    super(
      "The AI is busy right now (rate limit or high demand). Wait a few seconds and try again.",
      // Keep the provider's own message attached. Without it this error erases
      // the only evidence of WHICH limit was hit, and a per-minute blip and a
      // spent daily allowance become indistinguishable in the logs.
      cause === undefined ? undefined : { cause },
    );
    this.name = "RateLimitedError";
  }
}

/**
 * One specific model has spent its daily allowance. Extends RateLimitedError on
 * purpose: every caller that already degrades gracefully on a rate limit (the
 * marker's fallback, the ranker's heuristic ordering, the re-highlighter) keeps
 * working with no change, and callers that care about the distinction can test
 * for this subtype.
 *
 * The message deliberately omits the model id — it reaches real users, who are
 * owed something honest ("today", not "a few seconds") but not our internals.
 */
export class ModelUnavailableError extends RateLimitedError {
  readonly model: string;

  constructor(model: string) {
    super();
    this.name = "ModelUnavailableError";
    this.model = model;
    this.message = "The AI has reached today's request limit. Please try again later.";
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
  /** Model to retry on when the preferred one is rate-limited or out of quota.
   *  Prefer `fallbackFor(task, tier)` from lib/models.ts over a literal. */
  fallbackModel?: string;
}

/**
 * One Gemini call that must produce JSON. Returns the parsed value, or null
 * if the model's output wasn't parseable — callers decide how to fail honestly.
 *
 * When `fallbackModel` is set, a rate limit or exhausted daily quota on the
 * preferred model drops to the fallback rather than failing the request. That is
 * what keeps the app working on a free key where the premium model is capped at
 * 20 requests/day: quality degrades for the rest of the day, the feature does not
 * disappear. Availability is re-probed periodically (lib/modelAvailability), so
 * the premium model returns on its own once the cap is lifted.
 */
export async function generateJson(opts: GenerateJsonOptions): Promise<unknown> {
  const primary = opts.model ?? GEMINI_MODEL;
  try {
    return await generateJsonOn(primary, opts);
  } catch (err) {
    if (!shouldFailOver(err, primary, opts.fallbackModel)) throw err;
    console.warn(`gemini: ${primary} unavailable (${describe(err)}); using ${opts.fallbackModel}`);
    return await generateJsonOn(opts.fallbackModel as string, withFallbackRetries(opts));
  }
}

/**
 * Callers pass `retries: 0` so a doomed premium call fails fast instead of
 * burning ~10s of backoff when a fallback exists. That reasoning does NOT carry
 * over to the fallback itself: it is the last resort, so a single per-minute
 * blip on it would fail the whole request with nothing left to try. Restore the
 * normal ladder for that leg.
 *
 * This is not hypothetical — it is exactly how a live cut failed. Eight marker
 * sections all failed over to the cheap model at once, one of them met a
 * per-minute 429, and `retries: 0` turned that into a dead card instead of a
 * three-second wait.
 */
function withFallbackRetries<T extends { retries?: number }>(opts: T): T {
  return { ...opts, retries: undefined };
}

/** True when `err` is worth retrying on a different model. */
function shouldFailOver(err: unknown, primary: string, fallback?: string): boolean {
  return !!fallback && fallback !== primary && err instanceof RateLimitedError;
}

/** Short reason string for the fallback log line. */
function describe(err: unknown): string {
  return err instanceof ModelUnavailableError ? "daily quota spent" : "rate limited";
}

/** One JSON call against ONE specific model, with the retry ladder. */
async function generateJsonOn(model: string, opts: GenerateJsonOptions): Promise<unknown> {
  const ai = getGemini();
  const maxRetries = opts.retries ?? RETRY_DELAYS_MS.length;

  // Try once, then retry on transient errors with backoff. Non-transient errors
  // fail immediately.
  for (let attempt = 0; ; attempt++) {
    // Skip a model already known to be out of quota — no point paying for the
    // round trip, and exactly one caller is let through to re-probe it.
    if (!claimModelAttempt(model)) throw new ModelUnavailableError(model);
    try {
      await throttleGemini();
      const response = await withGeminiBreaker(model, () =>
        withSlot(() =>
          ai.models.generateContent({
            model,
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
      markModelAvailable(model);      return extractJson(response.text ?? "");
    } catch (err) {
      // Out of daily allowance: park the model and give up on it immediately.
      // Retrying buys nothing — the window resets tomorrow, not in 3 seconds.
      if (isDailyQuotaExhausted(err)) {
        markModelExhausted(model);
        throw new ModelUnavailableError(model);
      }
      // A probe that failed for any OTHER reason isn't a quota problem, so stop
      // treating the model as parked and let the breaker own it from here.
      markModelAvailable(model);
      // An open circuit means this model is already known-down; retrying here
      // would just re-throw instantly in a loop. Surface the message now.
      if (err instanceof CircuitOpenError) throw new RateLimitedError();
      if (!isTransient(err)) throw err;
      if (attempt >= maxRetries) throw new RateLimitedError(err);
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
  /** Model to retry on when the preferred one is rate-limited or out of quota. */
  fallbackModel?: string;
}

/**
 * Lower-level Gemini call for the assistant/agent loop: sends the full `contents`
 * (multi-turn + function-response turns) and optional tools, and returns the raw
 * response so the caller can read `functionCalls` / `text`. Same transient-retry
 * and model-failover behavior as generateJson.
 */
export async function generateContentRaw(
  opts: GenerateContentRawOptions,
): Promise<GenerateContentResponse> {
  const primary = opts.model ?? GEMINI_MODEL;
  try {
    return await generateContentRawOn(primary, opts.thinkingBudget ?? 0, opts);
  } catch (err) {
    if (!shouldFailOver(err, primary, opts.fallbackModel)) throw err;
    console.warn(`gemini: ${primary} unavailable (${describe(err)}); using ${opts.fallbackModel}`);
    /*
     * Thinking is dropped on the fallback. The fallback is always the cheap
     * model (see fallbackFor), whose value here is that it ANSWERS — and
     * `thinkingBudget: 0` is the only configuration this project has actually
     * verified working on it (npm run check:models probes exactly that shape).
     * Carrying a 2048-token budget over from the Coach's premium config risks
     * turning a graceful degradation into a 400.
     */
    return await generateContentRawOn(opts.fallbackModel as string, 0, withFallbackRetries(opts));
  }
}

/** One raw call against ONE specific model, with the retry ladder. */
async function generateContentRawOn(
  model: string,
  thinkingBudget: number,
  opts: GenerateContentRawOptions,
): Promise<GenerateContentResponse> {
  const ai = getGemini();
  const maxRetries = opts.retries ?? RETRY_DELAYS_MS.length;
  for (let attempt = 0; ; attempt++) {
    if (!claimModelAttempt(model)) throw new ModelUnavailableError(model);
    try {
      await throttleGemini();
      const response = await withGeminiBreaker(model, () =>
        withSlot(() =>
          ai.models.generateContent({
            model,
            contents: opts.contents,
            config: {
              systemInstruction: opts.system,
              temperature: opts.temperature ?? 0.3,
              maxOutputTokens: opts.maxOutputTokens ?? 4096,
              thinkingConfig: { thinkingBudget },
              ...(opts.tools ? { tools: opts.tools } : {}),
            },
          }),
        ),
      );
      markModelAvailable(model);      return response;
    } catch (err) {
      if (isDailyQuotaExhausted(err)) {
        markModelExhausted(model);
        throw new ModelUnavailableError(model);
      }
      markModelAvailable(model);
      if (err instanceof CircuitOpenError) throw new RateLimitedError();
      if (!isTransient(err)) throw err;
      if (attempt >= maxRetries) throw new RateLimitedError(err);
      await sleep(withJitter(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]));
    }
  }
}
