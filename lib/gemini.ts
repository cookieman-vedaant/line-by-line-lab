import { GoogleGenAI } from "@google/genai";
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

// The free tier's per-minute cap resets every ~60s, so a brief wait usually
// clears a 429 from a burst of quick uses. Retry a couple of times with backoff
// before giving up — turns "you're rate limited, stop" into "hang on a sec".
const RETRY_DELAYS_MS = [4000, 10000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimit(err: unknown): boolean {
  return (
    err instanceof Error && /429|RESOURCE_EXHAUSTED|quota/i.test(err.message)
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

/** Thrown when the free-tier quota is hit — surfaced as a friendly retry hint. */
export class RateLimitedError extends Error {
  constructor() {
    super(
      "The free AI quota was hit for the moment. Wait a minute and try again.",
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
}

/**
 * One Gemini call that must produce JSON. Returns the parsed value, or null
 * if the model's output wasn't parseable — callers decide how to fail honestly.
 */
export async function generateJson(opts: GenerateJsonOptions): Promise<unknown> {
  const ai = getGemini();

  // Try once, then retry on rate-limit with backoff (RETRY_DELAYS_MS.length
  // extra attempts). Non-rate-limit errors fail immediately.
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
      if (!isRateLimit(err)) throw err;
      if (attempt >= RETRY_DELAYS_MS.length) throw new RateLimitedError();
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}
