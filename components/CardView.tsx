"use client";

import { useState } from "react";
import type { Article, Card } from "@/types";

interface CardViewProps {
  card: Card;
  article: Article;
}

/**
 * Render the card body: `**...**` spans are emphasized warrants (bold +
 * underline, standard debate convention); everything else is kept-but-unread
 * text rendered smaller, exactly as a cut card reads.
 */
function renderBody(body: string) {
  return body.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold underline decoration-2">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return (
      <span key={i} className="text-[0.8em] text-zinc-500 dark:text-zinc-400">
        {part}
      </span>
    );
  });
}

/** Plain-text version for the clipboard — markers stripped, structure kept. */
function cardToPlainText(card: Card): string {
  return `${card.tag}\n${card.cite} — ${card.citeDetails}\n\n${card.body.replaceAll("**", "")}`;
}

export default function CardView({ card, article }: CardViewProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(cardToPlainText(card));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section
      aria-label="Debate card"
      className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-bold leading-snug">{card.tag}</h2>
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

      <p className="mt-2 text-sm">
        <span className="font-bold">{card.cite}</span>{" "}
        <span className="text-zinc-500 dark:text-zinc-400">— {card.citeDetails}</span>
      </p>

      <div className="mt-4 leading-relaxed">{renderBody(card.body)}</div>

      <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
        Cut from{" "}
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          {article.publication}
        </a>
        . Verify the evidence before you run it — the AI recommends, you decide.
      </p>
    </section>
  );
}
