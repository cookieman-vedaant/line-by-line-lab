/**
 * Card markup: internal emphasis delimiters + parser.
 *
 * Emphasis is encoded with Unicode PRIVATE-USE characters that cannot occur
 * in real article text, so literal `==` / `__` in an article (code, math,
 * snake_case names, URLs) always renders as ordinary text instead of being
 * misread as markers:
 *   U+E000 text U+E001  -> "highlight" (cyan + bold + underline, 12pt)
 *   U+E002 text U+E003  -> "underline" (12pt)
 *   plain               -> "plain" (8pt, de-emphasized)
 * A toggle scanner handles nesting in either direction (highlight wins
 * wherever both are open). Delimiters are always consumed — never rendered.
 * (Constants use String.fromCharCode so the source stays ASCII-readable.)
 */

export const HIGHLIGHT_OPEN = String.fromCharCode(0xe000);
export const HIGHLIGHT_CLOSE = String.fromCharCode(0xe001);
export const UNDERLINE_OPEN = String.fromCharCode(0xe002);
export const UNDERLINE_CLOSE = String.fromCharCode(0xe003);

const DELIMITER_RE = new RegExp(
  `[${HIGHLIGHT_OPEN}${HIGHLIGHT_CLOSE}${UNDERLINE_OPEN}${UNDERLINE_CLOSE}]`,
  "g",
);

/** Remove every internal delimiter — user-visible text must contain none. */
export function stripDelimiters(text: string): string {
  return text.replace(DELIMITER_RE, "");
}

/**
 * Convert AI-written tag markup (`__key phrase__`) to internal underline
 * delimiters. Balanced pairs convert; leftover `__`/`==` marker characters
 * are stripped so strays never render. Only the tag uses AI markup — body
 * emphasis is applied programmatically in lib/emphasis.ts.
 */
export function tagMarkupToDelimiters(tag: string): string {
  return stripDelimiters(tag)
    .replace(/__([\s\S]+?)__/g, `${UNDERLINE_OPEN}$1${UNDERLINE_CLOSE}`)
    .replaceAll("__", "")
    .replaceAll("==", "");
}

export type MarkupNodeKind = "plain" | "underline" | "highlight";

export interface MarkupNode {
  kind: MarkupNodeKind;
  text: string;
}

export function parseCardMarkup(text: string): MarkupNode[] {
  const nodes: MarkupNode[] = [];
  let highlightOpen = false;
  let underlineOpen = false;
  let buf = "";
  let current: MarkupNodeKind = "plain";

  const kindNow = (): MarkupNodeKind =>
    highlightOpen ? "highlight" : underlineOpen ? "underline" : "plain";

  const flush = () => {
    if (buf.length > 0) {
      nodes.push({ kind: current, text: buf });
      buf = "";
    }
  };

  const setState = (highlight: boolean | null, underline: boolean | null) => {
    flush();
    if (highlight !== null) highlightOpen = highlight;
    if (underline !== null) underlineOpen = underline;
    current = kindNow();
  };

  for (const ch of text) {
    if (ch === HIGHLIGHT_OPEN) setState(true, null);
    else if (ch === HIGHLIGHT_CLOSE) setState(false, null);
    else if (ch === UNDERLINE_OPEN) setState(null, true);
    else if (ch === UNDERLINE_CLOSE) setState(null, false);
    else buf += ch;
  }
  flush();

  // Merge adjacent nodes of the same kind (state changes can fragment them),
  // and strip any delimiter that somehow survived so nothing internal leaks.
  const merged: MarkupNode[] = [];
  for (const node of nodes) {
    const clean = stripDelimiters(node.text);
    if (clean.length === 0) continue;
    const last = merged[merged.length - 1];
    if (last && last.kind === node.kind) {
      last.text += clean;
    } else {
      merged.push({ kind: node.kind, text: clean });
    }
  }
  return merged;
}
