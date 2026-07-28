"use client";

import { useState } from "react";
import { parseCardMarkup, stripDelimiters, type MarkupNode } from "@/lib/cardMarkup";
import type { Card } from "@/types";

interface CardViewProps {
  card: Card;
  /** Where the article came from, for the footer link (optional for pasted text). */
  sourceUrl?: string;
  sourceName?: string;
}

/**
 * Debate-card typography (per user spec):
 * Calibri throughout; underlined/highlighted text 12pt; shrunk unread text 8pt.
 */
const CARD_FONT = { fontFamily: "Calibri, 'Segoe UI', sans-serif" };

function renderNodes(nodes: MarkupNode[], plainClass: string) {
  return nodes.map((node, i) => {
    if (node.kind === "highlight") {
      return (
        <mark
          key={i}
          className="bg-cyan-300 font-bold underline decoration-2 text-[12pt] dark:bg-cyan-600 dark:text-zinc-50"
        >
          {node.text}
        </mark>
      );
    }
    if (node.kind === "underline") {
      return (
        <span key={i} className="underline text-[12pt]">
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

function nodesToHtml(nodes: MarkupNode[], plainSizePt: number): string {
  return nodes
    .map((node) => {
      const text = escapeHtml(node.text);
      if (node.kind === "highlight") {
        return `<b><u><span style="font-size:12pt;background:#00ffff">${text}</span></u></b>`;
      }
      if (node.kind === "underline") {
        return `<u><span style="font-size:12pt">${text}</span></u>`;
      }
      return `<span style="font-size:${plainSizePt}pt">${text}</span>`;
    })
    .join("");
}

function cardToHtml(card: Card): string {
  const tagHtml = parseCardMarkup(card.tag)
    .map((n) => {
      const text = escapeHtml(n.text);
      return n.kind === "plain" ? text : `<u>${text}</u>`;
    })
    .join("");

  const bodyHtml = card.body
    .split(/\n+/)
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p style="margin:0 0 8pt 0">${nodesToHtml(parseCardMarkup(p), 8)}</p>`)
    .join("");

  return (
    `<div style="font-family:Calibri, 'Segoe UI', sans-serif">` +
    `<p style="margin:0 0 6pt 0"><b><span style="font-size:13pt">${tagHtml}</span></b></p>` +
    `<p style="margin:0 0 8pt 0"><b><span style="font-size:12pt">${escapeHtml(card.cite)}</span></b> ` +
    `<span style="font-size:8pt">[${escapeHtml(card.citeDetails)}]</span></p>` +
    bodyHtml +
    `</div>`
  );
}

function cardToPlainText(card: Card): string {
  return `${stripDelimiters(card.tag)}\n${card.cite} [${stripDelimiters(card.citeDetails)}]\n\n${stripDelimiters(card.body)}`;
}

async function copyCard(card: Card): Promise<void> {
  const html = cardToHtml(card);
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

export default function CardView({ card, sourceUrl, sourceName }: CardViewProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await copyCard(card);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const paragraphs = card.body.split(/\n+/).filter((p) => p.trim().length > 0);

  return (
    <section
      aria-label="Debate card"
      style={CARD_FONT}
      className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
    >
      {/* Tag: bold 13pt, underlined key phrases */}
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-[13pt] font-bold leading-snug">
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
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium
            text-zinc-700 transition hover:bg-zinc-100
            dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          style={{ fontFamily: "inherit" }}
        >
          {copied ? "Copied ✓" : "Copy card"}
        </button>
      </div>

      {/* Cite: bold 12pt short cite + 8pt bracketed details */}
      <p className="mt-3 leading-snug">
        <span className="text-[12pt] font-bold">{card.cite}</span>{" "}
        <span className="text-[8pt] text-zinc-500 dark:text-zinc-400">
          [{stripDelimiters(card.citeDetails)}]
        </span>
      </p>

      {/* Body: 12pt underlined/highlighted, 8pt shrunk context */}
      <div className="mt-4 flex flex-col gap-3 leading-relaxed">
        {paragraphs.map((paragraph, i) => (
          <p key={i}>
            {renderNodes(
              parseCardMarkup(paragraph),
              "text-[8pt] text-zinc-500 dark:text-zinc-400",
            )}
          </p>
        ))}
      </div>

      <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500" style={{ fontFamily: "initial" }}>
        {sourceUrl ? (
          <>
            Cut from{" "}
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
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
