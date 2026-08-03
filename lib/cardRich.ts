import { parseCardMarkup, stripDelimiters } from "@/lib/cardMarkup";
import type { Card } from "@/types";

/**
 * Rich card content, with the rendered DOM as the source of truth.
 *
 * The card is an editable document: a debater types in it and formats it like
 * any word processor. So rather than keeping a parallel model in sync with an
 * editable surface, everything downstream reads the live DOM.
 *
 * That is also what keeps the exports honest. Clipboard HTML and .docx are both
 * built from the same extracted runs, so a download matches the screen and
 * matches what a Google Docs paste produces, instead of being a second
 * implementation that drifts.
 */

export const CONTEXT_PT = 8;
export const READ_PT = 11;
export const TAG_PT = 13;
export const FONT_SIZES = [5, 8, 11, 13, 16] as const;

export const CARD_FONTS = [
  "Calibri",
  "Times New Roman",
  "Georgia",
  "Arial",
  "Garamond",
  "Verdana",
] as const;
export type CardFont = (typeof CARD_FONTS)[number];

export const MUTED_HEX = "#808080";

export interface Run {
  text: string;
  bold: boolean;
  underline: boolean;
  italic: boolean;
  /** Uppercase hex without '#', or null. */
  highlight: string | null;
  sizePt: number;
  /** Uppercase hex without '#'. */
  color: string;
}

export interface CardDoc {
  tag: Run[];
  cite: Run[];
  details: Run[];
  body: Run[][];
}

/* ---------- initial HTML (what the editable surface starts as) ---------- */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function span(text: string, css: string): string {
  return `<span style="${css}">${esc(text)}</span>`;
}

/** The tag: 13pt bold, key phrases underlined. */
export function tagHtml(tag: string): string {
  return parseCardMarkup(tag)
    .map((n) =>
      span(
        n.text,
        `font-size:${TAG_PT}pt;font-weight:700${n.kind !== "plain" ? ";text-decoration:underline" : ""}`,
      ),
    )
    .join("");
}

export function citeHtml(cite: string): string {
  return span(stripDelimiters(cite), `font-size:${READ_PT}pt;font-weight:700`);
}

export function detailsHtml(details: string): string {
  return span(`[${stripDelimiters(details)}]`, `font-size:${READ_PT}pt;color:${MUTED_HEX}`);
}

/** One body paragraph: read-aloud text at 11pt, unread context shrunk and grey. */
export function bodyParagraphHtml(paragraph: string, highlightHex: string): string {
  return parseCardMarkup(paragraph)
    .map((n) => {
      if (n.kind === "highlight") {
        return span(
          n.text,
          `font-size:${READ_PT}pt;font-weight:700;text-decoration:underline;background-color:${highlightHex}`,
        );
      }
      if (n.kind === "underline") {
        return span(n.text, `font-size:${READ_PT}pt;text-decoration:underline`);
      }
      return span(n.text, `font-size:${CONTEXT_PT}pt;color:${MUTED_HEX}`);
    })
    .join("");
}

export function bodyParagraphs(body: string): string[] {
  return body.split(/\n+/).filter((p) => p.trim().length > 0);
}

/* ---------- DOM -> runs ---------- */

function toHex(color: string): string | null {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(",").map((v) => parseFloat(v.trim()));
  const [r, g, b, a = 1] = parts;
  if (a === 0) return null;
  const hex = [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  return hex.toUpperCase();
}

/**
 * Read one editable field into runs. Styles come from getComputedStyle on each
 * text node's parent, so however the browser happened to nest the spans that
 * editing produced, what we extract is what is actually rendered.
 */
export function readRuns(root: HTMLElement): Run[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs: Run[] = [];
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const text = node.textContent ?? "";
    if (text.length === 0) continue;
    const parent = node.parentElement;
    if (!parent) continue;

    const cs = getComputedStyle(parent);
    const bg = toHex(cs.backgroundColor);
    const run: Run = {
      text,
      bold: Number.parseInt(cs.fontWeight, 10) >= 600,
      underline: cs.textDecorationLine.includes("underline"),
      italic: cs.fontStyle === "italic",
      // A field's own background is not a highlight; only an inner span's is.
      highlight: parent === root ? null : bg,
      sizePt: Math.round(Number.parseFloat(cs.fontSize) * 0.75 * 10) / 10,
      color: toHex(cs.color) ?? "000000",
    };

    const last = runs[runs.length - 1];
    if (
      last &&
      last.bold === run.bold &&
      last.underline === run.underline &&
      last.italic === run.italic &&
      last.highlight === run.highlight &&
      last.sizePt === run.sizePt &&
      last.color === run.color
    ) {
      last.text += text;
    } else {
      runs.push(run);
    }
  }
  return runs;
}

export function readCard(root: HTMLElement): CardDoc {
  const one = (sel: string): Run[] => {
    const el = root.querySelector<HTMLElement>(sel);
    return el ? readRuns(el) : [];
  };

  // The body is one editable region, so paragraphs are whatever blocks the
  // browser left behind after editing — including ones the debater created by
  // pressing Enter, which carry no attribute of ours.
  const bodyRoot = root.querySelector<HTMLElement>('[data-field-group="body"]');
  const body = bodyRoot
    ? bodyRoot.children.length > 0
      ? Array.from(bodyRoot.children).map((el) => readRuns(el as HTMLElement))
      : [readRuns(bodyRoot)]
    : [];

  return {
    tag: one('[data-field="tag"]'),
    cite: one('[data-field="cite"]'),
    details: one('[data-field="details"]'),
    body: body.filter((runs) => runs.some((r) => r.text.trim().length > 0)),
  };
}

/* ---------- runs -> HTML (clipboard, and the .html download) ---------- */

function runHtml(r: Run, font: string): string {
  const css = [
    `font-family:${font}`,
    `font-size:${r.sizePt}pt`,
    r.bold ? "font-weight:700" : "font-weight:400",
    r.italic ? "font-style:italic" : "",
    r.underline ? "text-decoration:underline" : "",
    r.highlight ? `background-color:#${r.highlight}` : "",
    `color:#${r.color}`,
  ]
    .filter(Boolean)
    .join(";");
  return span(r.text, css);
}

export function docToHtml(doc: CardDoc, font: string): string {
  const line = (runs: Run[]) => runs.map((r) => runHtml(r, font)).join("");
  const p = (inner: string) => `<p style="margin:2pt 0 0 0;line-height:1.07">${inner}</p>`;
  return (
    `<div style="font-family:${font},sans-serif">` +
    // Heading 3 so the tag lands in the Google Docs document outline.
    `<h3 style="margin:2pt 0 0 0;line-height:1.07;font-weight:700">${line(doc.tag)}</h3>` +
    p(`${line(doc.cite)} ${line(doc.details)}`) +
    doc.body.map((b) => p(line(b))).join("") +
    `</div>`
  );
}

export function docToText(doc: CardDoc): string {
  const line = (runs: Run[]) => runs.map((r) => r.text).join("");
  return [line(doc.tag), `${line(doc.cite)} ${line(doc.details)}`, "", ...doc.body.map(line)].join(
    "\n",
  );
}

/** A standalone .html file of the card, openable and importable anywhere. */
export function docToHtmlFile(doc: CardDoc, font: string, title: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<title>${esc(title)}</title></head><body>${docToHtml(doc, font)}</body></html>`
  );
}

/** The card as first cut, before any editing — used to seed the editable DOM. */
export function initialCardHtml(card: Card, highlightHex: string): {
  tag: string;
  cite: string;
  details: string;
  body: string[];
} {
  return {
    tag: tagHtml(card.tag),
    cite: citeHtml(card.cite),
    details: detailsHtml(card.citeDetails),
    body: bodyParagraphs(card.body).map((p) => bodyParagraphHtml(p, highlightHex)),
  };
}
