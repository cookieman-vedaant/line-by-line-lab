"use client";

import { CARD_FONTS, FONT_SIZES, type CardFont } from "@/lib/cardFormat";

/**
 * Formatting bar for a cut card: bold, underline, highlight, highlighter color,
 * read size, and typeface.
 *
 * Every control preventDefaults its mousedown. Without that the browser clears
 * the text selection the moment the button takes focus, and the click would
 * arrive with nothing left to format.
 *
 * Controls that act on a selection are disabled when there isn't one, so the bar
 * says what it can do rather than failing silently.
 */

export type HighlightColor = "cyan" | "yellow" | "green";

export const HIGHLIGHT_HEX: Record<HighlightColor, string> = {
  cyan: "#00ffff",
  yellow: "#ffff00",
  green: "#00ff00",
};

const HIGHLIGHT_ORDER: HighlightColor[] = ["yellow", "cyan", "green"];

interface Props {
  hasSelection: boolean;
  active: { bold: boolean; underline: boolean; highlight: boolean };
  highlightColor: HighlightColor;
  font: CardFont;
  dirty: boolean;
  onToggleBold: () => void;
  onToggleUnderline: () => void;
  onToggleHighlight: () => void;
  onHighlightColor: (c: HighlightColor) => void;
  onSize: (pt: number) => void;
  onFont: (f: CardFont) => void;
  onReset: () => void;
}

const BTN =
  "frame btn-press inline-flex h-8 min-w-8 items-center justify-center px-2 font-display text-xs font-bold";

export default function CardToolbar({
  hasSelection,
  active,
  highlightColor,
  font,
  dirty,
  onToggleBold,
  onToggleUnderline,
  onToggleHighlight,
  onHighlightColor,
  onSize,
  onFont,
  onReset,
}: Props) {
  // Keep the selection alive through the click.
  const hold = (e: React.MouseEvent) => e.preventDefault();

  const mark = (on: boolean) => (on ? "bg-accent text-paper" : "bg-paper-2 text-ink");

  return (
    <div
      data-print-hide
      className="frame mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 bg-paper p-2"
      role="toolbar"
      aria-label="Card formatting"
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onMouseDown={hold}
          onClick={onToggleBold}
          disabled={!hasSelection}
          aria-pressed={active.bold}
          title="Bold the selection"
          className={`${BTN} ${mark(active.bold)}`}
        >
          B
        </button>
        <button
          type="button"
          onMouseDown={hold}
          onClick={onToggleUnderline}
          disabled={!hasSelection}
          aria-pressed={active.underline}
          title="Underline the selection"
          className={`${BTN} underline ${mark(active.underline)}`}
        >
          U
        </button>
        <button
          type="button"
          onMouseDown={hold}
          onClick={onToggleHighlight}
          disabled={!hasSelection}
          aria-pressed={active.highlight}
          title="Highlight the selection"
          className={`${BTN} ${mark(active.highlight)}`}
        >
          H
        </button>
      </div>

      <div className="flex items-center gap-1.5" role="group" aria-label="Highlighter color">
        {HIGHLIGHT_ORDER.map((c) => (
          <button
            key={c}
            type="button"
            onMouseDown={hold}
            onClick={() => onHighlightColor(c)}
            aria-label={`${c} highlighter`}
            aria-pressed={highlightColor === c}
            title={`${c[0].toUpperCase()}${c.slice(1)} highlighter`}
            style={{ backgroundColor: HIGHLIGHT_HEX[c] }}
            className={`h-6 w-6 rounded-full border-2 transition ${
              highlightColor === c ? "border-ink ring-2 ring-accent" : "border-ink/30 hover:border-ink"
            }`}
          />
        ))}
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Text size">
        {FONT_SIZES.map((pt) => (
          <button
            key={pt}
            type="button"
            onMouseDown={hold}
            onClick={() => onSize(pt)}
            disabled={!hasSelection}
            title={`Set the selection to ${pt}pt`}
            className={`${BTN} bg-paper-2 text-ink`}
          >
            {pt}
          </button>
        ))}
        <span className="label-mono ml-0.5 text-[10px] text-ink/50">pt</span>
      </div>

      <label className="flex items-center gap-2">
        <span className="sr-only">Card typeface</span>
        <select
          value={font}
          onChange={(e) => onFont(e.target.value as CardFont)}
          className="frame h-8 bg-paper-2 px-2 text-xs font-semibold text-ink"
        >
          {CARD_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      {dirty && (
        <button
          type="button"
          onMouseDown={hold}
          onClick={onReset}
          title="Remove your formatting and return the card to how it was cut"
          className="label-mono ml-auto text-[10px] text-ink/60 underline hover:text-accent"
        >
          Reset formatting
        </button>
      )}
    </div>
  );
}
