"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CardToolbar, { HIGHLIGHT_HEX, type HighlightColor } from "@/components/CardToolbar";
import {
  enableCssStyling,
  queryActive,
  setFontFamily,
  setHighlight,
  setSizePt,
  toggleBold,
  toggleItalic,
  toggleUnderline,
} from "@/lib/cardEdit";
import { downloadDocx, downloadHtml } from "@/lib/cardExport";
import { type CardFont, docToHtml, docToText, readCard, sheetHtml } from "@/lib/cardRich";
import type { Card } from "@/types";

interface CardViewProps {
  card: Card;
  sourceUrl?: string;
  sourceName?: string;
  kicker?: string;
}

/**
 * A cut card you can edit and format like a document.
 *
 * Two rules keep this working, both learned the hard way:
 *
 * 1. ONE editable host for the whole card. A selection cannot span separate
 *    contentEditable elements and execCommand only acts on the focused one, so
 *    splitting the card per field made dragging across it and formatting it
 *    impossible.
 *
 * 2. React never renders into that host. Its content is written once,
 *    imperatively, and remounted via `key` when a new card arrives. Any
 *    re-render that reconciled this subtree would discard whatever had been
 *    typed, so state that changes while editing (selection flags) must never
 *    produce a new object unless the value actually changed.
 */
export default function CardView({ card, sourceUrl, sourceName, kicker = "✂ Cut Card" }: CardViewProps) {
  const [font, setFont] = useState<CardFont>("Calibri");
  const [highlightColor, setHighlightColor] = useState<HighlightColor>("cyan");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState({ bold: false, italic: false, underline: false });
  const [edited, setEdited] = useState(false);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  /** The last selection made inside the card, so a toolbar control can restore
      it. Opening a <select> moves focus and collapses the selection; without
      this, every command would arrive with nothing to act on. */
  const savedRange = useRef<Range | null>(null);
  const editedOnce = useRef(false);

  const cardKey = `${card.cite}|${card.tag}`;

  const attachSheet = useCallback(
    (el: HTMLDivElement | null) => {
      sheetRef.current = el;
      if (!el) return;
      // Written once. React owns no children here.
      el.innerHTML = sheetHtml(card, HIGHLIGHT_HEX.cyan);
      enableCssStyling();

      const onInput = () => {
        if (editedOnce.current) return; // one state change, not one per keystroke
        editedOnce.current = true;
        setEdited(true);
      };
      el.addEventListener("input", onInput);
      return () => el.removeEventListener("input", onInput);
    },
    [card],
  );

  useEffect(() => {
    const onSelectionChange = () => {
      const sheet = sheetRef.current;
      const sel = document.getSelection();
      if (!sheet || !sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!sheet.contains(range.commonAncestorContainer)) return;

      savedRange.current = range.cloneRange();
      const next = {
        bold: queryActive("bold"),
        italic: queryActive("italic"),
        underline: queryActive("underline"),
      };
      // Bail out when nothing changed, or every selection tick re-renders the
      // card and typing loses its place.
      setActive((prev) =>
        prev.bold === next.bold && prev.italic === next.italic && prev.underline === next.underline
          ? prev
          : next,
      );
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  /** Put focus and the saved selection back, then run a command against it. */
  const cmd = useCallback((fn: () => void) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.focus({ preventScroll: true });
    const range = savedRange.current;
    if (range) {
      const sel = document.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    fn();
  }, []);

  const readDoc = useCallback(() => (sheetRef.current ? readCard(sheetRef.current) : null), []);

  async function handleCopy() {
    const doc = readDoc();
    if (!doc) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([docToHtml(doc, font)], { type: "text/html" }),
          "text/plain": new Blob([docToText(doc)], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(docToText(doc));
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDocx() {
    const doc = readDoc();
    if (!doc) return;
    setBusy(true);
    try {
      await downloadDocx(doc, font, card.cite);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <CardToolbar
        active={active}
        highlightColor={highlightColor}
        font={font}
        copied={copied}
        busy={busy}
        onBold={() => cmd(toggleBold)}
        onItalic={() => cmd(toggleItalic)}
        onUnderline={() => cmd(toggleUnderline)}
        onHighlight={() => cmd(() => setHighlight(HIGHLIGHT_HEX[highlightColor]))}
        onClearHighlight={() => cmd(() => setHighlight(null))}
        onHighlightColor={(c) => {
          setHighlightColor(c);
          // Recolour what's selected now, rather than only arming the next one.
          cmd(() => setHighlight(HIGHLIGHT_HEX[c]));
        }}
        onSize={(pt) => cmd(() => setSizePt(pt))}
        onFont={(f) => {
          setFont(f);
          cmd(() => setFontFamily(f));
        }}
        onCopy={handleCopy}
        onDocx={handleDocx}
        onHtml={() => {
          const doc = readDoc();
          if (doc) downloadHtml(doc, font, card.cite);
        }}
      />

      <section
        aria-label="Debate card"
        style={{ fontFamily: `${font}, 'Segoe UI', sans-serif` }}
        className="shadow-hard-lg border-[3px] border-black bg-white p-6"
      >
        <div className="mb-4 flex items-center justify-between gap-4 border-b-[3px] border-black pb-3">
          <span className="label-mono border-[3px] border-black bg-black px-2 py-1 text-[10px] text-white">
            {kicker}
          </span>
          <span className="label-mono text-[10px] normal-case text-neutral-500">
            {edited ? "Edited by you" : "Click any text to edit it"}
          </span>
        </div>

        <div
          key={cardKey}
          ref={attachSheet}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Card content"
          spellCheck={false}
          className="text-black outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />

        <p className="label-mono mt-5 border-t-[3px] border-black pt-3 text-[10px] normal-case text-neutral-500">
          {sourceUrl ? (
            <>
              Cut from{" "}
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-neutral-800 underline">
                {sourceName ?? sourceUrl}
              </a>
              .{" "}
            </>
          ) : null}
          {edited
            ? "You have edited this card, so it no longer matches the source word for word. Check it before you read it."
            : "Verify the evidence before you run it — the AI recommends, you decide."}
        </p>
      </section>
    </div>
  );
}
