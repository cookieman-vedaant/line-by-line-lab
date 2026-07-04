import { GoogleGenAI } from "@google/genai";
import { extractJson } from "@/lib/json";

// Free-tier friendly default; override with GEMINI_MODEL in .env.local.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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
}

/**
 * One Gemini call that must produce JSON. Returns the parsed value, or null
 * if the model's output wasn't parseable — callers decide how to fail honestly.
 */
export async function generateJson(opts: GenerateJsonOptions): Promise<unknown> {
  const ai = getGemini();

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: opts.prompt,
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: opts.maxOutputTokens ?? 8192,
      },
    });
    return extractJson(response.text ?? "");
  } catch (err) {
    if (
      err instanceof Error &&
      /429|RESOURCE_EXHAUSTED|quota/i.test(err.message)
    ) {
      throw new RateLimitedError();
    }
    throw err;
  }
}
