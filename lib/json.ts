/**
 * Pull a JSON value out of a model's text output. Models are instructed to
 * return pure JSON, but this tolerates prose or a ```json fence around it.
 * Returns null if nothing parseable is found — callers treat that as a
 * failure, never as an excuse to fabricate.
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
