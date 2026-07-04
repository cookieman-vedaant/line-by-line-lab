"use client";

import { useState } from "react";
import type { Card } from "@/types";

/** Shown after the cite, replicating the sample card's cutter initials. */
const CUTTER_INITIALS = "//vedaant";

interface CardViewProps {
  card: Card;
  /** Where the article came from, for the footer link (optional for pasted text). */
  sourceUrl?: string;
  sourceName?: string;
}

/**
 * Render emphasis markup, replicating the sample card (Rodrigues 16):
 *   ==text==  → cyan highlight + bold + underline (key warrants)
 *   __text__  → underline (read-aloud text)
 *   plain     → small, de-emphasized (kept but unread)
 */
function renderSpans(text: string, plainClass: string) {
  const tokens = text.split(/(==(?:(?!==)[\s\S])+==|__(?:(?!__)[\s\S])+__)/g);
  return tokens.map((token, i) => {
    if (token.startsWith("==") && token.endsWith("==")) {
      return (
        <mark
          key={i}
          className="bg-cyan-300 font-bold underline decoration-2 dark:bg-cyan-600 dark:text-zinc-50"
        >
          {token.slice(2, -2)}
        </mark>
      );
    }
    if (token.startsWith("__") && token.endsWith("__")) {
      return (
        <span key={i} className="underline">
          {token.slice(2, -2)}
        </span>
      );
    }
    // Strip any stray markers the model left unbalanced.
    const plain = token.replaceAll("==", "").replaceAll("__", "");
    if (!plain) return null;
    return (
      <span key={i} className={plainClass}>
        {plain}
      </span>
    );
  });
}

/** Plain-text version for the clipboard — markers stripped, structure kept. */
function cardToPlainText(card: Card): string {
  const strip = (s: string) => s.replaceAll("==", "").replaceAll("__", "");
  return `${strip(card.tag)}\n${card.cite} [${strip(card.citeDetails)}] ${CUTTER_INITIALS}\n\n${strip(card.body)}`;
}

export default function CardView({ card, sourceUrl, sourceName }: CardViewProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(cardToPlainText(card));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const paragraphs = card.body.split(/\n+/).filter((p) => p.trim().length > 0);

  return (
    <section
      aria-label="Debate card"
      className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
    >
      {/* Tag: bold overall, underlined key phrases */}
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-base font-bold leading-snug">
          {renderSpans(card.tag, "")}
        </h2>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium
            text-zinc-700 transition hover:bg-zinc-100
            dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {copied ? "Copied ✓" : "Copy card"}
        </button>
      </div>

      {/* Cite: bold short cite + bracketed details + cutter initials */}
      <p className="mt-3 leading-snug">
        <span className="text-lg font-bold">{card.cite}</span>{" "}
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          [{card.citeDetails.replaceAll("==", "").replaceAll("__", "")}] {CUTTER_INITIALS}
        </span>
      </p>

      {/* Body: three-layer emphasis */}
      <div className="mt-4 flex flex-col gap-3 leading-relaxed">
        {paragraphs.map((paragraph, i) => (
          <p key={i}>
            {renderSpans(paragraph, "text-[0.72em] text-zinc-500 dark:text-zinc-400")}
          </p>
        ))}
      </div>

      {sourceUrl && (
        <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
          Cut from{" "}
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {sourceName ?? sourceUrl}
          </a>
          . Verify the evidence before you run it — the AI recommends, you decide.
        </p>
      )}
      {!sourceUrl && (
        <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
          Verify the evidence before you run it — the AI recommends, you decide.
        </p>
      )}
    </section>
  );
}
