"use client";

import { useEffect, useRef, useState } from "react";
import { CARD_FONTS, FONT_SIZES, type CardFont } from "@/lib/cardRich";

/**
 * The card's formatting bar. Reads like a word processor's, because the card
 * below it is an editable document.
 *
 * Every control preventDefaults its mousedown: without that the browser drops
 * the text selection the instant the control takes focus, and the command
 * arrives with nothing to act on.
 */

export type HighlightColor = "cyan" | "yellow" | "green";

export const HIGHLIGHT_HEX: Record<HighlightColor, string> = {
  cyan: "#00ffff",
  yellow: "#ffff00",
  green: "#00ff00",
};

const HIGHLIGHT_ORDER: HighlightColor[] = ["yellow", "cyan", "green"];

const I = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true } as const;
const S = { stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const DownloadIcon = () => (
  <svg {...I}>
    <path d="M12 3v12" {...S} />
    <path d="m7 11 5 5 5-5" {...S} />
    <path d="M4 20h16" {...S} />
  </svg>
);
const CopyIcon = () => (
  <svg {...I}>
    <rect x="9" y="9" width="11" height="11" rx="1" {...S} />
    <path d="M15 5H5a1 1 0 0 0-1 1v10" {...S} />
  </svg>
);
const CheckIcon = () => (
  <svg {...I}>
    <path d="m4 12 5 5L20 6" {...S} />
  </svg>
);
const HighlighterIcon = () => (
  <svg {...I}>
    <path d="M14 4 7 11l-2 6 6-2 7-7z" {...S} />
    <path d="M4 21h7" {...S} />
  </svg>
);

interface Props {
  active: { bold: boolean; italic: boolean; underline: boolean };
  highlightColor: HighlightColor;
  font: CardFont;
  copied: boolean;
  busy: boolean;
  onBold: () => void;
  onItalic: () => void;
  onUnderline: () => void;
  onHighlight: () => void;
  onClearHighlight: () => void;
  onHighlightColor: (c: HighlightColor) => void;
  onSize: (pt: number) => void;
  onFont: (f: CardFont) => void;
  onCopy: () => void;
  onDocx: () => void;
  onHtml: () => void;
}

const BTN =
  "frame btn-press inline-flex h-8 min-w-8 items-center justify-center gap-1.5 px-2 font-display text-xs font-bold";
const SEP = <span aria-hidden className="h-6 w-px shrink-0 bg-ink/15" />;

export default function CardToolbar(p: Props) {
  const hold = (e: React.MouseEvent) => e.preventDefault();
  const on = (v: boolean) => (v ? "bg-accent text-paper" : "bg-paper-2 text-ink");

  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  return (
    <div
      className="frame mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 bg-paper p-2"
      role="toolbar"
      aria-label="Card formatting"
    >
      <div className="flex items-center gap-1">
        <button type="button" onMouseDown={hold} onClick={p.onBold} aria-pressed={p.active.bold}
          title="Bold (Ctrl+B)" className={`${BTN} ${on(p.active.bold)}`}>B</button>
        <button type="button" onMouseDown={hold} onClick={p.onItalic} aria-pressed={p.active.italic}
          title="Italic (Ctrl+I)" className={`${BTN} italic ${on(p.active.italic)}`}>I</button>
        <button type="button" onMouseDown={hold} onClick={p.onUnderline} aria-pressed={p.active.underline}
          title="Underline (Ctrl+U)" className={`${BTN} underline ${on(p.active.underline)}`}>U</button>
      </div>

      {SEP}

      <div className="flex items-center gap-1">
        <button type="button" onMouseDown={hold} onClick={p.onHighlight}
          title="Highlight the selection" className={`${BTN} bg-paper-2 text-ink`}>
          <HighlighterIcon />
        </button>
        {HIGHLIGHT_ORDER.map((c) => (
          <button key={c} type="button" onMouseDown={hold} onClick={() => p.onHighlightColor(c)}
            aria-label={`${c} highlighter`} aria-pressed={p.highlightColor === c}
            title={`${c[0].toUpperCase()}${c.slice(1)} highlighter`}
            style={{ backgroundColor: HIGHLIGHT_HEX[c] }}
            className={`h-6 w-6 rounded-full border-2 transition ${
              p.highlightColor === c ? "border-ink ring-2 ring-accent" : "border-ink/30 hover:border-ink"
            }`} />
        ))}
        <button type="button" onMouseDown={hold} onClick={p.onClearHighlight}
          title="Remove the highlight" className={`${BTN} bg-paper-2 text-ink/60`}>none</button>
      </div>

      {SEP}

      <label className="flex items-center gap-1.5">
        <span className="sr-only">Text size</span>
        <select onMouseDown={hold} defaultValue=""
          onChange={(e) => { if (e.target.value) { p.onSize(Number(e.target.value)); e.target.value = ""; } }}
          className="frame h-8 bg-paper-2 px-1.5 text-xs font-semibold text-ink">
          <option value="" disabled>size</option>
          {FONT_SIZES.map((pt) => <option key={pt} value={pt}>{pt} pt</option>)}
        </select>
      </label>

      <label className="flex items-center gap-1.5">
        <span className="sr-only">Typeface</span>
        <select value={p.font} onMouseDown={hold} onChange={(e) => p.onFont(e.target.value as CardFont)}
          className="frame h-8 bg-paper-2 px-1.5 text-xs font-semibold text-ink">
          {CARD_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>

      <div className="ml-auto flex items-center gap-2">
        <button type="button" onMouseDown={hold} onClick={p.onCopy}
          className={`${BTN} px-3 ${p.copied ? "bg-ink text-paper" : "bg-paper-2 text-ink"}`}>
          {p.copied ? <CheckIcon /> : <CopyIcon />}
          {p.copied ? "Copied" : "Copy"}
        </button>

        <div className="relative" ref={menuRef}>
          <button type="button" onClick={() => setMenu((v) => !v)} disabled={p.busy}
            aria-haspopup="menu" aria-expanded={menu} title="Download this card"
            className={`${BTN} bg-accent px-3 text-paper`}>
            <DownloadIcon />
            {p.busy ? "Saving…" : "Download"}
          </button>
          {menu && (
            <div role="menu"
              className="frame shadow-hard absolute right-0 z-20 mt-1 w-52 overflow-hidden bg-paper">
              <button type="button" role="menuitem"
                onClick={() => { setMenu(false); p.onDocx(); }}
                className="block w-full px-3 py-2 text-left text-xs font-semibold text-ink hover:bg-accent hover:text-paper">
                Word (.docx)
                <span className="block text-[10px] font-normal opacity-70">Opens in Word and Google Docs</span>
              </button>
              <button type="button" role="menuitem"
                onClick={() => { setMenu(false); p.onHtml(); }}
                className="divide-t block w-full px-3 py-2 text-left text-xs font-semibold text-ink hover:bg-accent hover:text-paper">
                Web page (.html)
                <span className="block text-[10px] font-normal opacity-70">Opens in any browser</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
