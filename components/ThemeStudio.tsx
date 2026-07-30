"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { requestTheme } from "@/lib/apiClient";
import {
  applyBuiltin,
  applyTheme,
  getThemeServerSnapshot,
  getThemeSnapshot,
  subscribeTheme,
} from "@/lib/theme";
import { PRESETS, PRESET_ORDER } from "@/lib/themeTokens";

/**
 * The theme agent's control: a compact popover to switch the base theme, apply a
 * one-click preset, or generate a custom theme from a typed vibe.
 *
 * The dropdown is PORTALED to document.body and positioned fixed. This is
 * deliberate: the page's intro animation (.reveal) leaves a transform on
 * ancestors, creating stacking contexts that would trap an in-tree dropdown
 * beneath later elements (the big <h1>) and make its buttons unclickable.
 * Portaling escapes all of that.
 */
export default function ThemeStudio() {
  const active = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function openMenu() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  }

  // Close on click-outside (checking BOTH the trigger and the portaled popover)
  // or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function generate() {
    const vibe = prompt.trim();
    if (!vibe || busy) return;
    setBusy(true);
    setError(null);
    const outcome = await requestTheme(vibe);
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    applyTheme(outcome.spec);
    setPrompt("");
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-expanded={open}
        className="label-mono frame btn-press bg-paper-2 px-3 py-1.5 text-[10px] font-bold text-ink hover:text-accent"
      >
        ✨ {active}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 60 }}
            className="frame shadow-hard w-64 bg-paper-2 p-3"
          >
            <p className="label-mono mb-2 text-[10px] text-ink/60">Base</p>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => applyBuiltin("rostrum")}
                className="btn-press frame flex-1 bg-paper px-2 py-1 text-xs font-bold hover:text-accent"
              >
                Bold
              </button>
              <button
                type="button"
                onClick={() => applyBuiltin("cut")}
                className="btn-press frame flex-1 bg-paper px-2 py-1 text-xs font-bold hover:text-accent"
              >
                Dark
              </button>
            </div>

            <p className="label-mono mb-2 text-[10px] text-ink/60">Presets</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {PRESET_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyTheme(PRESETS[id])}
                  className="btn-press frame bg-paper px-2 py-1 text-xs font-bold hover:text-accent"
                >
                  {PRESETS[id].name}
                </button>
              ))}
            </div>

            <p className="label-mono mb-2 text-[10px] text-ink/60">Design your own</p>
            <div className="flex gap-2">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void generate();
                }}
                placeholder="e.g. vaporwave, Charizard…"
                className="frame w-full bg-paper px-2 py-1 text-xs font-medium text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || !prompt.trim()}
                onClick={() => void generate()}
                className="btn-press frame bg-accent px-2 py-1 text-xs font-bold text-paper disabled:opacity-60"
              >
                {busy ? "…" : "Go"}
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-2 text-[11px] font-semibold text-red">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
