/**
 * A deliberately small Markdown parser for Coach replies.
 *
 * The Coach writes Markdown because that is what a chat model writes, but the
 * panel rendered its text raw — so debaters saw literal `**Impact**` instead of
 * bold, and numbered advice ran together as one wall of text.
 *
 * This parses to a DATA STRUCTURE that the component turns into React elements.
 * It deliberately does not produce HTML, and there is no `dangerouslySetInnerHTML`
 * anywhere on this path: the Coach's output includes text the user pasted in
 * (their own case, an opponent's card), so treating any of it as markup would be
 * an injection route straight through the model.
 *
 * The supported subset is what the Coach actually emits — bold, italic, inline
 * code, headings, bullet and numbered lists, paragraphs. Anything else is left
 * as literal text, which is the safe direction: an unrendered character is a
 * cosmetic problem, a mis-parsed one loses the debater's words.
 */

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type Block =
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "heading"; level: number; spans: Span[] }
  | { kind: "list"; ordered: boolean; items: Span[][] };

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;

/**
 * Split one line into styled spans.
 *
 * A marker only counts when its closer exists later on the line. Without that
 * check, a stray `**` — or the `*` in "5 * 3" — would style everything after it,
 * turning a typo into a paragraph of bold. Falling back to literal text keeps
 * the damage to the two characters actually involved.
 */
export function parseInline(line: string): Span[] {
  const spans: Span[] = [];
  let buf = "";
  let bold = false;
  let italic = false;
  let code = false;

  const flush = () => {
    if (buf) {
      spans.push({
        text: buf,
        ...(bold ? { bold: true } : {}),
        ...(italic ? { italic: true } : {}),
        ...(code ? { code: true } : {}),
      });
      buf = "";
    }
  };

  let i = 0;
  while (i < line.length) {
    const two = line.slice(i, i + 2);
    const ch = line[i];

    // Inside code, markup is literal — that is the point of code.
    if (code) {
      if (ch === "`") {
        flush();
        code = false;
        i += 1;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    if (ch === "`" && line.indexOf("`", i + 1) > i) {
      flush();
      code = true;
      i += 1;
      continue;
    }

    if ((two === "**" || two === "__") && (bold || line.indexOf(two, i + 2) > i + 1)) {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }

    // Single `*` only. A lone `_` is left alone so snake_case survives intact.
    if (ch === "*" && line[i + 1] !== "*" && (italic || line.indexOf("*", i + 1) > i)) {
      flush();
      italic = !italic;
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }
  flush();
  return spans;
}

/** Parse a Coach reply into renderable blocks. */
export function parseCoachMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];

  let para: string[] = [];
  let list: { ordered: boolean; items: Span[][] } | null = null;

  const closeParagraph = () => {
    if (para.length === 0) return;
    // Soft line breaks inside a paragraph are preserved (the component renders
    // with pre-wrap) because the Coach uses them to separate distinct points.
    blocks.push({ kind: "paragraph", spans: parseInline(para.join("\n")) });
    para = [];
  };
  const closeList = () => {
    if (!list) return;
    blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  const closeAll = () => {
    closeParagraph();
    closeList();
  };

  for (const raw of lines) {
    if (raw.trim() === "") {
      closeAll();
      continue;
    }

    const heading = HEADING.exec(raw);
    if (heading) {
      closeAll();
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        spans: parseInline(heading[2].trim()),
      });
      continue;
    }

    const numbered = NUMBERED.exec(raw);
    if (numbered) {
      closeParagraph();
      if (!list?.ordered) {
        closeList();
        list = { ordered: true, items: [] };
      }
      list.items.push(parseInline(numbered[2].trim()));
      continue;
    }

    const bullet = BULLET.exec(raw);
    if (bullet) {
      closeParagraph();
      if (!list || list.ordered) {
        closeList();
        list = { ordered: false, items: [] };
      }
      list.items.push(parseInline(bullet[1].trim()));
      continue;
    }

    // A plain line directly under a list item is a continuation of it, not a new
    // paragraph — otherwise wrapped advice gets torn out of its own bullet.
    if (list && list.items.length > 0) {
      const last = list.items[list.items.length - 1];
      last.push({ text: " " }, ...parseInline(raw.trim()));
      continue;
    }

    para.push(raw);
  }

  closeAll();
  return blocks;
}
