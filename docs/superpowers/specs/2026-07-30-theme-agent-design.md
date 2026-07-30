# Theme Agent — Design Spec

**Date:** 2026-07-30
**Status:** Approved design, pending implementation plan
**Scope:** Visual-only. No changes to Find Articles / Cut a Card / Coach behavior.

## 1. Overview

Add an in-app "theme agent" that lets a debater restyle Line by Line Lab from a
typed vibe ("Charizard", "JoJo Part 5", "vaporwave") or a one-click preset. The
agent generates a **ThemeSpec** — a small, validated JSON token set — which the
app applies over the *existing* token-driven theme system. Because every
component already reads semantic CSS variables (`--paper`, `--ink`, `--accent`,
`--bw`, `--radius`, …), applying a spec recolors the whole app automatically;
no component is modified.

### Goals
- Generate a cohesive, **readable** theme from any short prompt (1 Gemini call).
- Offer a few built-in presets (instant, no AI, and the AI's rate-limit fallback).
- Change colors, corner shape, border weight, background atmosphere, and font.
- Persist the active theme and apply it **before first paint** (no flash).
- Degrade gracefully: presets + the two existing themes always work, even with
  no API key or during a rate limit.

### Non-goals (YAGNI — not building unless asked later)
- Saved theme history / multiple stored customs, sharing, or export.
- A manual color-slider theme editor.
- Per-component or per-tab theming.
- Any functional/behavioral change to the debate tools.

## 2. Existing system this builds on (do not rewrite)
- `app/globals.css` — two themes (`[data-theme="rostrum"]` = "Bold",
  `[data-theme="cut"]` = "Dark") defined as CSS variables + structural vars
  (`--bw`, `--radius`, `--shadow*`) + per-theme background atmosphere and
  structural reinterpretations (`.frame`, `.bg-accent`, `.btn-press`, …).
- `app/layout.tsx` — loads fonts via `next/font`, sets `data-theme="rostrum"`,
  and runs an inline pre-paint script reading `localStorage['lbl-theme']`.
- `components/ThemeSwitcher.tsx` — Bold/Dark segmented toggle (will be replaced
  by `ThemeStudio`, keeping the same `data-theme` + localStorage contract).

## 3. ThemeSpec (the AI's output contract)

A single JSON object, validated with Zod. Constraining every field to a hex
color, an enum, or a bounded number is what prevents a generated theme from
breaking the layout.

```ts
interface ThemeSpec {
  name: string;              // e.g. "Charizard" (<= 40 chars)
  // Colors (7-char hex, #rrggbb)
  paper: string;             // page background base
  paper2: string;            // surface / card background
  ink: string;               // primary text
  stroke: string;            // border color
  accent: string;            // primary accent
  accent2: string;           // gradient partner / secondary accent
  warn: string;              // error/alert (maps to --red)
  highlight: string;         // highlighter (maps to --yellow)
  // Shape + mood
  borderWidth: number;       // 1..4 (px)  -> --bw
  radius: number;            // 0..20 (px) -> --radius
  mood: "bold" | "sleek";    // shadow language: hard offset vs soft glow
  background: "dots" | "grid" | "glow" | "gradient" | "solid";
  font: FontId;              // curated font pair (see §5)
}

type FontId = "zine" | "space" | "editorial" | "terminal" | "rounded" | "impact";
```

Mapping to CSS is a pure function `themeToCssVars(spec)` returning a
`Record<string,string>` of custom properties (`--paper`, `--paper-2`, `--ink`,
`--stroke`, `--accent`, `--accent-2`, `--red`, `--yellow`, `--bw`, `--radius`,
and mood-derived `--shadow`/`--shadow-lg`/`--shadow-btn`). The app also sets
`data-theme="custom"`, `data-bg="<background>"`, `data-mood="<mood>"`,
`data-font="<font>"` on `<html>` so the CSS-only pieces (background pattern,
gradient accent, glass/hard shadows, font vars) can key off them.

## 4. Readability guard (critical)

`ensureReadable(spec): ThemeSpec` runs immediately after generation (server-side)
and again is safe to call client-side for presets. It:
1. Computes relative-luminance contrast ratios (WCAG formula).
2. Enforces: `ink`↔`paper` ≥ 4.5; `paper2` visibly distinct from `paper`
   (ratio ≥ ~1.06); `accent`↔`paper` ≥ 3.0 (accent text/badges legible).
3. If a pair fails, **auto-nudges**: lighten/darken `ink` toward black/white
   until ink↔paper passes; nudge `paper2` toward/away from `paper`; adjust
   `accent` lightness until it passes. Deterministic, bounded loop.

This makes an unreadable theme impossible regardless of what the AI returns.
Pure and fully unit-tested (fixtures: low-contrast input → passes after adjust).

## 5. Fonts (curated set)

~6 font pairs preloaded via `next/font/google` in `layout.tsx`, each exposing a
uniquely-named CSS variable (e.g. `--font-space`, `--font-space-mono`). Applying
a theme sets `data-font` on `<html>`; CSS rules repoint the shared vars, e.g.
`[data-font="space"] { --font-display: var(--font-space); --font-mono: var(--font-space-mono); }`.
No inline font values are needed, so the pre-paint script only writes a short
string. Because all are `next/font`, switching is instant, flash-free, and the
browser only downloads the pair actually rendered. Non-default families use
`preload: false` so we don't preload all six for every visitor.

| FontId     | Display            | Mono/Secondary   | Vibe |
|------------|--------------------|------------------|------|
| `zine`     | Bricolage Grotesque| DM Mono          | default / bold zine (today) |
| `space`    | Space Grotesk      | Space Mono       | techy / clean |
| `editorial`| Fraunces           | DM Mono          | dramatic serif |
| `terminal` | JetBrains Mono     | JetBrains Mono   | hacker / Matrix |
| `rounded`  | Baloo 2            | DM Mono          | playful / Pokémon |
| `impact`   | Archivo (heavy)    | DM Mono          | bold condensed / JoJo |

(Exact families may be swapped for equivalent `next/font` options during build;
the FontId → variable contract is what matters.)

## 6. Data flow

```
User types "Charizard" in ThemeStudio (client)
  → POST /api/theme  { prompt }   (+ x-lbl-client header)
      route: validate prompt (Zod, <=120 chars), rate-limit + throttle
      → services/themeAgent.ts generateTheme(prompt)   [generateJson + Zod schema]
      → ensureReadable(spec)
  ← { spec: ThemeSpec }
  → applyTheme(spec)   set data-theme="custom" + inline CSS vars + data-*  attrs
  → saveTheme(spec)    localStorage["lbl-custom-theme"] = JSON, ["lbl-theme"]="custom"
```

Presets skip the network entirely: `applyTheme(PRESETS[id])` + `saveTheme`.

### No-flash persistence
Extend the inline pre-paint script in `layout.tsx`:
```
read lbl-theme;
if "custom": parse lbl-custom-theme JSON; set data-theme="custom" + the CSS vars
             + data-bg/data-mood/data-font on <html> before paint;
else: set data-theme = value (rostrum/cut) as today.
```
The pre-paint script only needs to write the color/number CSS vars inline plus
the four `data-*` strings (theme/bg/mood/font) from the saved JSON — the CSS
handles backgrounds, shadows, and fonts off those attributes. It duplicates the
minimal spec→vars mapping used by `applyTheme`/`themeToCssVars`; a unit test
asserts the two stay equal so they can't drift.

## 7. UI — `components/ThemeStudio.tsx`

Replaces `ThemeSwitcher` in the page header (same location). A compact control:
- Trigger button ("✨ Theme") opens a small popover (click-outside / Esc closes).
- **Built-in chips:** Bold · Dark · Pikachu · Charizard · JoJo (one-click).
- **Generate:** a "Describe a theme…" text input + Generate button.
  - While generating: inline spinner; on error: inline message; presets stay usable.
- **Reset:** back to Bold (`rostrum`).
- Reads current theme via the same external-store pattern as `ThemeSwitcher`
  (`data-theme` on `<html>`), so no hydration mismatch.

## 8. Error handling
- **No `GEMINI_API_KEY`** → Generate disabled with a hint; presets + Bold/Dark work.
- **RateLimitedError (429)** → friendly "themes are busy — try a preset" message.
- **Unparseable/invalid AI output** → Zod rejects → one retry → else friendly error.
- Generation uses the existing `clientKey` rate-limit + Gemini throttle; exactly
  1 Gemini call per generate. Presets cost nothing.

## 9. New / changed files
- `types/index.ts` — add `ThemeSpec`, `FontId`.
- `lib/themeTokens.ts` (new, pure) — `themeToCssVars`, font map, `ensureReadable`,
  `PRESETS`, contrast helpers.  **Unit-tested.**
- `services/themeAgent.ts` (new) — `generateTheme(prompt, clientKey?)` via
  `generateJson`; system prompt + Zod schema; calls `ensureReadable`.
- `app/api/theme/route.ts` (new, thin) — validate, rate-limit, call service.
- `components/ThemeStudio.tsx` (new) — popover UI; replaces `ThemeSwitcher`
  usage in `app/page.tsx`.
- `lib/theme.ts` (new, client) — `applyTheme`, `saveTheme`, `loadSavedTheme`.
- `app/globals.css` — `[data-theme="custom"]` baseline + `data-bg` background
  styles + `data-mood`/`data-font` rules.
- `app/layout.tsx` — load the curated fonts; extend the pre-paint script.
- `.env.example` — no new keys (reuses `GEMINI_API_KEY`); note the feature.
- `components/ThemeSwitcher.tsx` — removed/absorbed by `ThemeStudio`.

## 10. Testing

**Unit (pure logic, Vitest):**
- `ensureReadable`: low-contrast fixtures pass after adjustment; already-good
  specs are unchanged; edge cases (near-black paper, near-white ink).
- `themeToCssVars`: spec → expected variable map; mood→shadow mapping.
- Font map: every `FontId` resolves to a variable pair; unknown id rejected.
- Zod schema: valid spec accepted; out-of-range/bad-hex/bad-enum rejected.
- Pre-paint mapping matches `applyTheme` mapping (no drift).

**Manual / live (browser):**
- Generate "Charizard" → theme applies; text stays readable.
- Reload → persists, no flash.
- Each preset applies instantly.
- Rate-limit / no-key path shows the fallback and presets still work.
- All three tabs (Find/Cut/Coach) look correct under a generated theme.

## 11. Security / constraints
- Visual-only; the agent returns colors/enums/numbers, never markup or code —
  no CSS/HTML injection surface (values are set via the CSSOM as property values
  and validated hex/enum/number, not concatenated into a stylesheet string).
- Reuses `GEMINI_API_KEY`; no new secrets. $0 (free tier). Strict TypeScript,
  no `any`. No auth. No fabrication concerns (not evidence).
