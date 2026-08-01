"use client";

import { useState } from "react";
import { parseCardMarkup, stripDelimiters, type MarkupNode } from "@/lib/cardMarkup";
import type { Card } from "@/types";

interface CardViewProps {
  card: Card;
  /** Where the article came from, for the footer link (optional for pasted text). */
  sourceUrl?: string;
  sourceName?: string;
  /** Masthead label (defaults to the cutter's). */
  kicker?: string;
}

/**
 * Debate-card typography (per user spec):
 * Calibri throughout; underlined/highlighted text 11pt; shrunk unread text 8pt.
 */
const CARD_FONT = { fontFamily: "Calibri, 'Segoe UI', sans-serif" };

/** Highlighter colors a debater can pick per card (cyan is the default). */
export type HighlightColor = "cyan" | "yellow" | "green";
const HIGHLIGHT_HEX: Record<HighlightColor, string> = {
  cyan: "#00ffff",
  yellow: "#ffff00",
  green: "#00ff00",
};
const HIGHLIGHT_ORDER: HighlightColor[] = ["cyan", "yellow", "green"];

function renderNodes(nodes: MarkupNode[], plainClass: string, highlightHex: string) {
  return nodes.map((node, i) => {
    if (node.kind === "highlight") {
      return (
        <mark
          key={i}
          style={{ backgroundColor: highlightHex }}
          className="font-bold underline decoration-2 text-[11pt] text-black"
        >
          {node.text}
        </mark>
      );
    }
    if (node.kind === "underline") {
      return (
        <span key={i} className="underline text-[11pt]">
          {node.text}
        </span>
      );
    }
    return (
      <span key={i} className={plainClass}>
        {node.text}
      </span>
    );
  });
}

/* ---------- Copy: rich HTML so pasting into Word/Google Docs keeps the cut ---------- */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function nodesToHtml(nodes: MarkupNode[], plainSizePt: number, highlightHex: string): string {
  return nodes
    .map((node) => {
      const text = escapeHtml(node.text);
      if (node.kind === "highlight") {
        return `<b><u><span style="font-size:11pt;background:${highlightHex}">${text}</span></u></b>`;
      }
      if (node.kind === "underline") {
        return `<u><span style="font-size:11pt">${text}</span></u>`;
      }
      return `<span style="font-size:${plainSizePt}pt">${text}</span>`;
    })
    .join("");
}

function cardToHtml(card: Card, highlightHex: string): string {
  const tagHtml = parseCardMarkup(card.tag)
    .map((n) => {
      const text = escapeHtml(n.text);
      return n.kind === "plain" ? text : `<u>${text}</u>`;
    })
    .join("");

  // Body paragraphs: 2pt before / 0 after, so the card pastes in tight. Emphasis
  // is 11pt; kept-but-unread context stays 8pt.
  const bodyHtml = card.body
    .split(/\n+/)
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p style="margin:2pt 0 0 0">${nodesToHtml(parseCardMarkup(p), 8, highlightHex)}</p>`)
    .join("");

  return (
    `<div style="font-family:Calibri, 'Segoe UI', sans-serif">` +
    // Tag as Heading 3 so it lands in the Google Docs outline; inline overrides
    // keep it black Calibri 13pt with 1.07 line spacing (2pt before / 0 after).
    `<h3 style="font-family:Calibri, 'Segoe UI', sans-serif; font-size:13pt; font-weight:bold; color:#000000; line-height:1.07; margin:2pt 0 0 0">${tagHtml}</h3>` +
    `<p style="margin:2pt 0 0 0"><b><span style="font-size:11pt">${escapeHtml(card.cite)}</span></b> ` +
    `<span style="font-size:11pt">[${escapeHtml(card.citeDetails)}]</span></p>` +
    bodyHtml +
    `</div>`
  );
}

function cardToPlainText(card: Card): string {
  return `${stripDelimiters(card.tag)}\n${card.cite} [${stripDelimiters(card.citeDetails)}]\n\n${stripDelimiters(card.body)}`;
}

async function copyCard(card: Card, highlightHex: string): Promise<void> {
  const html = cardToHtml(card, highlightHex);
  const text = cardToPlainText(card);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
  } catch {
    // Older browsers: plain text is better than nothing.
    await navigator.clipboard.writeText(text);
  }
}

/* ---------- Component ---------- */

export default function CardView({ card, sourceUrl, sourceName, kicker = "✂ Cut Card" }: CardViewProps) {
  const [copied, setCopied] = useState(false);
  const [highlightColor, setHighlightColor] = useState<HighlightColor>("cyan");
  // A freshly cut card is a new object — reset the highlighter back to default.
  const [prevCard, setPrevCard] = useState(card);
  if (card !== prevCard) {
    setPrevCard(card);
    setHighlightColor("cyan");
  }
  const highlightHex = HIGHLIGHT_HEX[highlightColor];

  async function handleCopy() {
    await copyCard(card, highlightHex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const paragraphs = card.body.split(/\n+/).filter((p) => p.trim().length > 0);

  return (
    <section
      aria-label="Debate card"
      style={CARD_FONT}
      className="shadow-hard-lg border-[3px] border-black bg-white p-6"
    >
      {/* Masthead: mono kicker + copy button (display/mono fonts, not Calibri).
          The card is a fixed white "sheet" in both themes, so its chrome is
          fixed-dark — only the copy button carries the theme accent. */}
      <div className="mb-4 flex items-center justify-between gap-4 border-b-[3px] border-black pb-3">
        <span className="label-mono border-[3px] border-black bg-black px-2 py-1 text-[10px] text-white">
          {kicker}
        </span>
        <div className="flex items-center gap-3">
          {/* Highlighter color — recolors every highlight in this card, in both
              the preview and the copied Google-Docs HTML. */}
          <div className="flex items-center gap-1.5" role="group" aria-label="Highlight color">
            {HIGHLIGHT_ORDER.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setHighlightColor(c)}
                aria-label={`${c} highlights`}
                aria-pressed={highlightColor === c}
                title={`${c[0].toUpperCase() + c.slice(1)} highlights`}
                style={{ backgroundColor: HIGHLIGHT_HEX[c] }}
                className={`h-5 w-5 rounded-full transition ${
                  highlightColor === c
                    ? "border-[3px] border-black ring-2 ring-black ring-offset-1"
                    : "border-2 border-black/40 hover:border-black"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className={`btn-press shrink-0 border-[3px] border-black px-3 py-1.5 font-display text-xs
              font-bold uppercase tracking-wide ${copied ? "bg-black text-white" : "bg-accent text-paper"}`}
          >
            {copied ? "Copied ✓" : "Copy card"}
          </button>
        </div>
      </div>

      {/* Tag: bold 13pt, underlined key phrases */}
      <h2 className="text-[13pt] font-bold leading-snug text-black">
        {parseCardMarkup(card.tag).map((n, i) =>
          n.kind === "plain" ? (
            <span key={i}>{n.text}</span>
          ) : (
            <span key={i} className="underline">
              {n.text}
            </span>
          ),
        )}
      </h2>

      {/* Cite: bold 12pt short cite + 8pt bracketed details */}
      <p className="mt-3 leading-snug text-black">
        <span className="text-[11pt] font-bold">{card.cite}</span>{" "}
        <span className="text-[11pt] text-neutral-500">[{stripDelimiters(card.citeDetails)}]</span>
      </p>

      {/* Body: 11pt underlined/highlighted, 8pt shrunk context */}
      <div className="mt-4 flex flex-col gap-3 leading-relaxed text-black">
        {paragraphs.map((paragraph, i) => (
          <p key={i}>
            {renderNodes(parseCardMarkup(paragraph), "text-[8pt] text-neutral-500", highlightHex)}
          </p>
        ))}
      </div>

      <p className="label-mono mt-5 border-t-[3px] border-black pt-3 text-[10px] normal-case text-neutral-500">
        {sourceUrl ? (
          <>
            Cut from{" "}
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-800 underline"
            >
              {sourceName ?? sourceUrl}
            </a>
            .{" "}
          </>
        ) : null}
        Verify the evidence before you run it — the AI recommends, you decide.
      </p>
    </section>
  );
}
