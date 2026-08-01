"use client";

import { useState } from "react";
import type { Contradiction, ContradictionKind } from "@/types";

/** Kind → badge label + zine-palette classes (all existing tokens). */
const KIND: Record<ContradictionKind, { label: string; badgeClass: string }> = {
  contradiction: { label: "Contradiction", badgeClass: "bg-red text-white" },
  omitted_context: { label: "Omitted context", badgeClass: "bg-yellow text-black" },
  author_hedge: { label: "Author hedge", badgeClass: "bg-accent text-paper" },
  miscut: { label: "Miscut", badgeClass: "bg-ink text-paper" },
};

const QUOTE_FONT = { fontFamily: "Calibri, 'Segoe UI', sans-serif" };

interface ContradictionCardProps {
  item: Contradiction;
  /** Position in the stack — drives the staggered reveal delay. */
  index: number;
}

export default function ContradictionCard({ item, index }: ContradictionCardProps) {
  const [copied, setCopied] = useState(false);
  const meta = KIND[item.kind];

  async function handleCopy() {
    const text = `"${item.quote}"\n\n${item.explanation}\n\nHow to run it: ${item.howToUse}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — no-op; the text is still on screen.
    }
  }

  return (
    <article
      className="frame reveal shadow-hard-lg bg-paper-2 p-5"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span
          className={`label-mono border-[3px] border-black px-2 py-1 text-[10px] ${meta.badgeClass}`}
        >
          {meta.label}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={`btn-press shrink-0 border-[3px] border-black px-2.5 py-1 font-display text-[10px]
            font-bold uppercase tracking-wide ${copied ? "bg-black text-white" : "bg-paper text-ink"}`}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>

      {/* Verbatim author wording — the load-bearing part. */}
      <blockquote
        style={QUOTE_FONT}
        className="border-l-4 border-accent bg-paper px-3 py-2 text-[11pt] font-medium leading-snug text-ink"
      >
        “{item.quote}”
      </blockquote>

      <p className="mt-3 text-sm leading-relaxed text-ink/80">{item.explanation}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink">
        <span className="label-mono text-[10px] text-accent">How to run it → </span>
        {item.howToUse}
      </p>
    </article>
  );
}
