"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CardToolbar, { HIGHLIGHT_HEX, type HighlightColor } from "@/components/CardToolbar";
import {
  queryActive,
  setFontFamily,
  setHighlight,
  setSizePt,
  toggleBold,
  toggleItalic,
  toggleUnderline,
  enableCssStyling,
} from "@/lib/cardEdit";
import { downloadDocx, downloadHtml } from "@/lib/cardExport";
import { type CardFont, docToHtml, docToText, initialCardHtml, readCard } from "@/lib/cardRich";
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
 * The rendered card IS the model: it starts as the cut output and from then on
 * the debater edits it directly, so React seeds each field once and never
 * re-renders into it (a re-render would wipe whatever they had typed). A new
 * card arrives as a new object, which remounts the surface through `key`.
 *
 * Every field is editable and formattable, tag and cite included. Copy and both
 * downloads read the same live DOM, so what leaves the app is what is on screen.
 */
export default function CardView({ card, sourceUrl, sourceName, kicker = "✂ Cut Card" }: CardViewProps) {
  const [font, setFont] = useState<CardFont>("Calibri");
  const [highlightColor, setHighlightColor] = useState<HighlightColor>("cyan");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState({ bold: false, italic: false, underline: false });
  const [edited, setEdited] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Seeded once per card. Deliberately not reactive to the highlighter colour:
  // that picks the colour for the NEXT highlight, it does not restyle the card.
  const initial = useMemo(() => initialCardHtml(card, HIGHLIGHT_HEX.cyan), [card]);

  useEffect(() => {
    enableCssStyling();
    const sync = () => {
      const el = sheetRef.current;
      if (!el || !el.contains(document.getSelection()?.anchorNode ?? null)) return;
      setActive({
        bold: queryActive("bold"),
        italic: queryActive("italic"),
        underline: queryActive("underline"),
      });
    };
    document.addEventListener("selectionchange", sync);
    return () => document.removeEventListener("selectionchange", sync);
  }, []);

  const readDoc = useCallback(() => {
    const el = sheetRef.current;
    return el ? readCard(el) : null;
  }, []);

  async function handleCopy() {
    const doc = readDoc();
    if (!doc) return;
    const html = docToHtml(doc, font);
    const text = docToText(doc);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(text);
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

  function handleHtml() {
    const doc = readDoc();
    if (doc) downloadHtml(doc, font, card.cite);
  }

  const field =
    "outline-none focus:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent";

  return (
    <div key={`${card.cite}|${card.tag}`}>
      <CardToolbar
        active={active}
        highlightColor={highlightColor}
        font={font}
        copied={copied}
        busy={busy}
        onBold={toggleBold}
        onItalic={toggleItalic}
        onUnderline={toggleUnderline}
        onHighlight={() => setHighlight(HIGHLIGHT_HEX[highlightColor])}
        onClearHighlight={() => setHighlight(null)}
        onHighlightColor={setHighlightColor}
        onSize={setSizePt}
        onFont={(f) => {
          setFont(f);
          setFontFamily(f); // styles the selection too, if there is one
        }}
        onCopy={handleCopy}
        onDocx={handleDocx}
        onHtml={handleHtml}
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
            {edited ? "Edited by you" : "Click any text to edit"}
          </span>
        </div>

        <div
          ref={sheetRef}
          onInput={() => setEdited(true)}
          className="text-black"
          suppressContentEditableWarning
        >
          <h2 className="leading-snug">
            <span
              data-field="tag"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Card tag"
              className={`block ${field}`}
              dangerouslySetInnerHTML={{ __html: initial.tag }}
            />
          </h2>

          <p className="mt-3 leading-snug">
            <span
              data-field="cite"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Citation"
              className={field}
              dangerouslySetInnerHTML={{ __html: initial.cite }}
            />{" "}
            <span
              data-field="details"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Citation details"
              className={field}
              dangerouslySetInnerHTML={{ __html: initial.details }}
            />
          </p>

          <div
            data-field-group="body"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Card body"
            className={`mt-4 leading-relaxed ${field}`}
            dangerouslySetInnerHTML={{
              __html: initial.body.map((p) => `<p style="margin:0 0 0.65rem 0">${p}</p>`).join(""),
            }}
          />
        </div>

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
