/** Where to send a user when no valid destination was supplied. */
export const DEFAULT_NEXT = "/lab";

/**
 * Space (32) and every C0 control character below it. Browsers strip or
 * normalise these before resolving a URL, which is how a value like "/ /evil.com"
 * gets past a parser that only looked at the first character.
 */
function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) <= 32) return true;
  }
  return false;
}

/**
 * Validate a `?next=` destination before navigating to it.
 *
 * `value.startsWith("/")` is the obvious check and it is not enough: `//evil.com`
 * starts with a slash and is a PROTOCOL-RELATIVE URL, so a browser handed it by
 * router.push/replace or window.location leaves the site entirely. Backslashes
 * are the same trap, because browsers normalise a backslash to a slash in the
 * authority position, so "/\evil.com" escapes just as well.
 *
 * So: exactly one leading slash, no backslash straight after it, and no
 * whitespace or control characters. Anything else falls back to the default
 * rather than being repaired — a `next` we don't fully understand is not one
 * worth honouring.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return DEFAULT_NEXT;
  if (value[0] !== "/") return DEFAULT_NEXT;
  if (value[1] === "/" || value[1] === "\\") return DEFAULT_NEXT;
  if (hasControlOrSpace(value)) return DEFAULT_NEXT;
  return value;
}
