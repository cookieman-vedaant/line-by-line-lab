"use client";

import { useSyncExternalStore } from "react";

type ThemeId = "rostrum" | "cut";

const THEMES: { id: ThemeId; label: string }[] = [
  { id: "rostrum", label: "Bold" },
  { id: "cut", label: "Dark" },
];

const STORAGE_KEY = "lbl-theme";

// The active theme lives on <html data-theme> (set pre-paint by the inline
// script in layout). Treat that as an external store so the component reads it
// without a setState-in-effect and without a hydration mismatch.
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): ThemeId {
  return document.documentElement.getAttribute("data-theme") === "cut" ? "cut" : "rostrum";
}

function getServerSnapshot(): ThemeId {
  return "rostrum";
}

function setTheme(id: ThemeId): void {
  document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // private mode / storage disabled — the choice just won't persist.
  }
  listeners.forEach((l) => l());
}

/** Segmented toggle to switch the app's visual theme; persists to localStorage. */
export default function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div className="frame inline-flex" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTheme(t.id)}
          aria-pressed={theme === t.id}
          className={`label-mono px-3 py-1.5 text-[10px] font-bold ${
            theme === t.id ? "bg-accent text-paper" : "bg-transparent text-ink/60 hover:text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
