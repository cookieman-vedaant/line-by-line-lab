import Anthropic from "@anthropic-ai/sdk";

// One model for both jobs. Card-cutting quality is the whole product, so we
// default to the most capable model; swap to a faster model later if needed.
export const CLAUDE_MODEL = "claude-opus-4-8";

/** Thrown when the server is missing its API key — surfaced as a clean 500. */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "The server isn't configured with a Claude API key yet. Add ANTHROPIC_API_KEY to .env.local and restart the dev server.",
    );
    this.name = "MissingApiKeyError";
  }
}

let client: Anthropic | null = null;

/** Lazily create the Anthropic client. Fails loudly (not silently) without a key. */
export function getClaude(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new MissingApiKeyError();
  }
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return client;
}

/** Concatenate all text blocks from a response's content. */
export function textFromContent(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Pull a JSON object out of a model's final text. Claude is instructed to end
 * with pure JSON, but this tolerates prose or a ```json fence around it.
 * Returns null if nothing parseable is found — callers treat that as a failure,
 * never as an excuse to fabricate.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // 1. The whole message is JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  // 2. A fenced ```json block.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      // fall through
    }
  }

  // 3. The outermost { ... } span.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // fall through
    }
  }

  return null;
}
