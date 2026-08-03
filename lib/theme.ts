import { CSS_VAR_KEYS, themeToPayload } from "@/lib/themeTokens";
import type { AppliedTheme, ThemeSpec } from "@/types";

/**
 * Client-side glue that applies a theme to the document and persists it, plus a
 * tiny external store so ThemeStudio re-renders when the theme changes. The pure
 * token math lives in lib/themeTokens.ts; this file only touches the DOM and
 * localStorage. Keys/shape match the pre-paint script in app/layout.tsx.
 */

/** Minimal surface of documentElement we touch — lets tests pass a fake. */
export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  style: { setProperty(k: string, v: string): void; removeProperty(k: string): void };
}

const THEME_KEY = "lbl-theme";
const CUSTOM_KEY = "lbl-custom-theme";

/**
 * Flag the document while a theme is being applied. globals.css scopes its
 * cross-fade to this attribute, so the whole-tree transition it needs exists
 * for the length of the switch instead of permanently.
 */
let themingTimer: ReturnType<typeof setTimeout> | undefined;
function flagTheming(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theming", "");
  clearTimeout(themingTimer);
  themingTimer = setTimeout(() => root.removeAttribute("data-theming"), 420);
}

function docRoot(): ThemeRoot {
  return document.documentElement as unknown as ThemeRoot;
}

export function applyPayload(payload: AppliedTheme, root: ThemeRoot = docRoot()): void {
  root.setAttribute("data-theme", "custom");
  root.setAttribute("data-bg", payload.dataset.bg);
  root.setAttribute("data-mood", payload.dataset.mood);
  root.setAttribute("data-font", payload.dataset.font);
  for (const [k, v] of Object.entries(payload.vars)) root.style.setProperty(k, v);
}

export function applyTheme(spec: ThemeSpec): void {
  flagTheming();
  const payload = themeToPayload(spec);
  applyPayload(payload);
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(payload));
    localStorage.setItem(THEME_KEY, "custom");
  } catch {
    /* storage disabled — theme just won't persist */
  }
  notify();
}

export function applyBuiltin(id: "rostrum" | "cut"): void {
  flagTheming();
  const root = docRoot();
  for (const a of ["data-bg", "data-mood", "data-font"]) root.removeAttribute(a);
  for (const k of CSS_VAR_KEYS) root.style.removeProperty(k);
  root.setAttribute("data-theme", id);
  try {
    localStorage.setItem(THEME_KEY, id);
    localStorage.removeItem(CUSTOM_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

// --- external store so ThemeStudio re-renders on theme change ---
const listeners = new Set<() => void>();
function notify(): void {
  listeners.forEach((l) => l());
}

export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Returns "rostrum" | "cut" | the custom theme's name (for the trigger label). */
export function getThemeSnapshot(): string {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "custom") {
    try {
      const raw = localStorage.getItem(CUSTOM_KEY);
      if (raw) return (JSON.parse(raw) as AppliedTheme).name;
    } catch {
      /* ignore */
    }
    return "custom";
  }
  return t === "cut" ? "cut" : "rostrum";
}

export function getThemeServerSnapshot(): string {
  return "rostrum";
}
