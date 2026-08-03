"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  /**
   * Flag the control as unexplored until it has been opened once. Done as an
   * attribute from the ref rather than React state so it costs no render and
   * cannot mismatch during hydration, since localStorage is unreadable on the
   * server.
   */
  const HINT_KEY = "lbl-theme-seen";
  const setTrigger = useCallback((el: HTMLButtonElement | null) => {
    triggerRef.current = el;
    if (!el) return;
    try {
      if (localStorage.getItem(HINT_KEY) !== "1") el.setAttribute("data-hint", "");
    } catch {
      /* storage disabled: just don't hint */
    }
  }, []);

  function markSeen() {
    triggerRef.current?.removeAttribute("data-hint");
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* ignore */
    }
  }

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
        ref={setTrigger}
        type="button"
        onClick={() => {
          markSeen();
          if (open) setOpen(false);
          else openMenu();
        }}
        aria-expanded={open}
        title="Theme Studio: restyle the whole app, or describe a look and let the agent build it"
        className="theme-trigger label-mono frame btn-press relative flex items-center gap-1.5 bg-paper-2 px-2.5 py-1.5 text-[10px] font-bold text-ink hover:text-accent"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.6 1.6-1.4 0-.5-.2-.8-.5-1.1-.3-.3-.4-.6-.4-1 0-.8.6-1.4 1.4-1.4H16a5 5 0 0 0 5-5c0-4.4-4-8.1-9-8.1Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="7.5" cy="11.5" r="1.3" fill="currentColor" />
          <circle cx="11" cy="7.5" r="1.3" fill="currentColor" />
          <circle cx="15.5" cy="9" r="1.3" fill="currentColor" />
        </svg>
        <span>Theme</span>
        <span className="hidden text-ink/45 md:inline">· {active}</span>
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
