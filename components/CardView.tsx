"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CardToolbar, { HIGHLIGHT_HEX, type HighlightColor } from "@/components/CardToolbar";
import { downloadDocx, printCard } from "@/lib/cardExport";
import {
  type CardFont,
  type CardFormat,
  type ComposedCard,
  EMPTY_FORMAT,
  type FormatSpan,
  type Run,
  activeMarks,
  composeCard,
  resetSpans,
  withSpan,
} from "@/lib/cardFormat";
import { readSelection, type FieldSelection } from "@/lib/cardSelection";
import { stripDelimiters } from "@/lib/cardMarkup";
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
 * A cut card, plus the formatting a debater layers on top of it.
 *
 * The card's words are never editable. Formatting is a set of marks over
 * character ranges (lib/cardFormat.ts), so a debater can restyle a card as much
 * as they like and the evidence still reads exactly as the author wrote it.
 *
 * Preview, clipboard HTML and the .docx all render from the same composed runs,
 * so what is copied or downloaded is what is on screen.
 */

/* ---------- clipboard ---------- */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function runsToHtml(runs: Run[], font: string, greyMuted: boolean): string {
  return runs
    .map((r) => {
      const css = [
        `font-size:${r.sizePt}pt`,
        `font-family:${font}`,
        r.bold ? "font-weight:bold" : "",
        r.underline ? "text-decoration:underline" : "",
        r.highlight ? `background:${r.highlight}` : "",
        greyMuted && r.muted ? "color:#808080" : "color:#000000",
      ]
        .filter(Boolean)
        .join(";");
      return `<span style="${css}">${escapeHtml(r.text)}</span>`;
    })
    .join("");
}

function composedToHtml(c: ComposedCard): string {
  const body = c.body
    .map((p) => `<p style="margin:2pt 0 0 0">${runsToHtml(p, c.font, true)}</p>`)
    .join("");
  return (
    `<div style="font-family:${c.font}, sans-serif">` +
    // Heading 3 so the tag lands in the Google Docs outline.
    `<h3 style="font-size:13pt;font-weight:bold;color:#000;line-height:1.07;margin:2pt 0 0 0">` +
    `${runsToHtml(c.tag, c.font, false)}</h3>` +
    `<p style="margin:2pt 0 0 0">${runsToHtml(c.cite, c.font, false)} ` +
    `<span style="font-size:11pt;font-family:${c.font}">[${escapeHtml(c.citeDetails)}]</span></p>` +
    body +
    `</div>`
  );
}

function composedToText(c: ComposedCard): string {
  const flat = (runs: Run[]) => runs.map((r) => r.text).join("");
  return `${flat(c.tag)}\n${flat(c.cite)} [${c.citeDetails}]\n\n${c.body.map(flat).join("\n\n")}`;
}

/* ---------- run rendering ---------- */

function RunSpan({ run, greyMuted }: { run: Run; greyMuted: boolean }) {
  return (
    <span
      style={{
        fontSize: `${run.sizePt}pt`,
        ...(run.highlight ? { backgroundColor: run.highlight } : null),
      }}
      className={[
        run.bold ? "font-bold" : "",
        run.underline ? "underline decoration-2" : "",
        greyMuted && run.muted ? "text-neutral-500" : "text-black",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {run.text}
    </span>
  );
}

function Runs({ runs, greyMuted }: { runs: Run[]; greyMuted: boolean }) {
  return (
    <>
      {runs.map((r, i) => (
        <RunSpan key={i} run={r} greyMuted={greyMuted} />
      ))}
    </>
  );
}

/* ---------- component ---------- */

export default function CardView({ card, sourceUrl, sourceName, kicker = "✂ Cut Card" }: CardViewProps) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [highlightColor, setHighlightColor] = useState<HighlightColor>("cyan");
  const [format, setFormat] = useState<CardFormat>(EMPTY_FORMAT);
  const [sel, setSel] = useState<FieldSelection | null>(null);
  const cardRef = useRef<HTMLElement>(null);

  // A freshly cut card is a new object: drop the previous card's formatting.
  const [prevCard, setPrevCard] = useState(card);
  if (card !== prevCard) {
    setPrevCard(card);
    setHighlightColor("cyan");
    setFormat(EMPTY_FORMAT);
    setSel(null);
  }

  const highlightHex = HIGHLIGHT_HEX[highlightColor];
  const composed = composeCard(card, format, highlightHex);

  useEffect(() => {
    const onChange = () => {
      const el = cardRef.current;
      setSel(el ? readSelection(el) : null);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  const runsFor = useCallback(
    (s: FieldSelection): Run[] => {
      if (s.field === "tag") return composed.tag;
      if (s.field === "cite") return composed.cite;
      return composed.body[s.para] ?? [];
    },
    [composed],
  );

  const active = sel
    ? activeMarks(runsFor(sel), sel.start, sel.end)
    : { bold: false, underline: false, highlight: false };

  const apply = (patch: Omit<FormatSpan, "field" | "para" | "start" | "end">) => {
    if (!sel) return;
    setFormat((f) => withSpan(f, { ...sel, ...patch }));
  };

  async function handleCopy() {
    const html = composedToHtml(composed);
    const text = composedToText(composed);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(text); // older browsers
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDocx() {
    setBusy(true);
    try {
      await downloadDocx(composed, card.cite);
    } finally {
      setBusy(false);
    }
  }

  function handlePdf() {
    if (cardRef.current) printCard(cardRef.current);
  }

  const chrome =
    "btn-press shrink-0 border-[3px] border-black px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide";

  return (
    <div>
      <CardToolbar
        hasSelection={sel !== null}
        active={active}
        highlightColor={highlightColor}
        font={format.font}
        dirty={format.spans.length > 0 || format.font !== EMPTY_FORMAT.font}
        onToggleBold={() => apply({ bold: !active.bold })}
        onToggleUnderline={() => apply({ underline: !active.underline })}
        onToggleHighlight={() =>
          apply(
            active.highlight
              ? { highlight: null }
              : { highlight: highlightHex, bold: true, underline: true },
          )
        }
        onHighlightColor={setHighlightColor}
        onSize={(pt) => apply({ sizePt: pt })}
        onFont={(f: CardFont) => setFormat((prev) => ({ ...prev, font: f }))}
        onReset={() => setFormat((f) => ({ ...resetSpans(f), font: EMPTY_FORMAT.font }))}
      />

      <section
        ref={cardRef}
        aria-label="Debate card"
        style={{ fontFamily: `${composed.font}, 'Segoe UI', sans-serif` }}
        className="shadow-hard-lg border-[3px] border-black bg-white p-6"
      >
        <div
          data-print-hide
          className="mb-4 flex items-center justify-between gap-4 border-b-[3px] border-black pb-3"
        >
          <span className="label-mono border-[3px] border-black bg-black px-2 py-1 text-[10px] text-white">
            {kicker}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePdf}
              title="Open the print dialog and save the card as a PDF"
              className={`${chrome} bg-white text-black`}
            >
              PDF
            </button>
            <button
              type="button"
              onClick={handleDocx}
              disabled={busy}
              title="Download the card as a Word document"
              className={`${chrome} bg-white text-black`}
            >
              {busy ? "…" : "DOCX"}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className={`${chrome} ${copied ? "bg-black text-white" : "bg-accent text-paper"}`}
            >
              {copied ? "Copied ✓" : "Copy card"}
            </button>
          </div>
        </div>

        <h2 className="leading-snug text-black">
          <span data-field="tag" data-para={0}>
            <Runs runs={composed.tag} greyMuted={false} />
          </span>
        </h2>

        <p className="mt-3 leading-snug text-black">
          <span data-field="cite" data-para={0}>
            <Runs runs={composed.cite} greyMuted={false} />
          </span>{" "}
          <span className="text-[11pt] text-neutral-500">[{composed.citeDetails}]</span>
        </p>

        <div className="mt-4 flex flex-col gap-3 leading-relaxed text-black">
          {composed.body.map((para, i) => (
            <p key={i} data-field="body" data-para={i}>
              <Runs runs={para} greyMuted />
            </p>
          ))}
        </div>

        <p
          data-print-hide
          className="label-mono mt-5 border-t-[3px] border-black pt-3 text-[10px] normal-case text-neutral-500"
        >
          {sourceUrl ? (
            <>
              Cut from{" "}
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-800 underline"
              >
                {sourceName ?? stripDelimiters(sourceUrl)}
              </a>
              .{" "}
            </>
          ) : null}
          Select any text to format it. The words stay exactly as the author wrote them.
        </p>
      </section>
    </div>
  );
}
