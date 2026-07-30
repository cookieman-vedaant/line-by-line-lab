# Theme Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a debater restyle the app from a typed vibe or a one-click preset by generating a validated `ThemeSpec` that is applied over the existing token-driven theme system.

**Architecture:** The AI (or a preset) yields a small validated `ThemeSpec` (colors, shape, background, font). Pure code maps it to CSS custom properties + `data-*` attributes on `<html>`; every component already reads those tokens, so the whole app recolors with zero component changes. A readability guard makes unreadable output impossible. Persistence stores a precomputed payload that a generic pre-paint script replays before first paint (no flash, no mapping duplication).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (strict), Tailwind 4 CSS variables, Zod, `@google/genai` via existing `lib/gemini`, `next/font/google`, Vitest.

## Global Constraints
- Strict TypeScript; no `any` (use `unknown` + guards). Copied verbatim from AGENTS.md.
- $0 budget: reuse `GEMINI_API_KEY`; add NO new paid services. No new secrets.
- Never expose secrets to the client. Keep API route handlers thin; logic in `services/`/`lib/`.
- Visual-only: no behavioral change to Find Articles / Cut a Card / Coach.
- Unit-test pure logic; manually verify UI/CSS in the browser (project convention).
- Follow ESLint/Prettier defaults; no lint warnings in new code.
- Test runner command: `npx vitest run <file>`. Type check: `npx tsc --noEmit`. Build: `npm run build`.

## File Structure
- `types/index.ts` — **modify:** add `ThemeSpec`, `FontId`, `BackgroundStyle`, `ThemeMood`, `AppliedTheme`.
- `lib/themeTokens.ts` — **create (pure, tested):** Zod schema, color/contrast helpers, `ensureReadable`, `themeToCssVars`, `themeToPayload`, `CSS_VAR_KEYS`, `FONT_IDS`, `PRESETS`, `PRESET_ORDER`.
- `lib/themeTokens.test.ts` — **create.**
- `services/themeAgent.ts` — **create:** `generateTheme(prompt)` (Gemini + schema + `ensureReadable`).
- `services/themeAgent.test.ts` — **create** (mocks `lib/gemini`).
- `app/api/theme/route.ts` — **create (thin):** POST → validate prompt → `generateTheme`.
- `app/api/theme/route.test.ts` — **create** (mocks the service).
- `lib/theme.ts` — **create (DOM/storage glue + store):** `applyPayload`, `applyTheme`, `applyBuiltin`, plus a `useSyncExternalStore` source.
- `lib/theme.test.ts` — **create** (fake root stub; no jsdom needed).
- `app/globals.css` — **modify:** font defaults + `[data-font=…]` rules + `[data-theme="custom"]` background/mood rules.
- `app/layout.tsx` — **modify:** load 8 `next/font` families; generic pre-paint script.
- `components/ThemeStudio.tsx` — **create:** popover UI (built-ins + presets + generate).
- `app/page.tsx` — **modify:** render `ThemeStudio` instead of `ThemeSwitcher`.
- `components/ThemeSwitcher.tsx` — **delete** (absorbed by `ThemeStudio`).
- `lib/apiClient.ts` — **modify:** add `requestTheme(prompt)`.

---

### Task 1: ThemeSpec types + Zod schema + color/contrast helpers

**Files:**
- Modify: `types/index.ts`
- Create: `lib/themeTokens.ts`
- Test: `lib/themeTokens.test.ts`

**Interfaces:**
- Produces: `ThemeSpec`, `FontId`, `BackgroundStyle`, `ThemeMood` (types); `themeSpecSchema` (Zod); `hexToRgb(hex:string)`, `relativeLuminance(hex:string):number`, `contrastRatio(a:string,b:string):number`.

- [ ] **Step 1: Add types to `types/index.ts`** (append near other exported types)

```ts
export type FontId = "zine" | "space" | "editorial" | "terminal" | "rounded" | "impact";
export type BackgroundStyle = "dots" | "grid" | "glow" | "gradient" | "solid";
export type ThemeMood = "bold" | "sleek";

export interface ThemeSpec {
  name: string;
  paper: string;
  paper2: string;
  ink: string;
  stroke: string;
  accent: string;
  accent2: string;
  warn: string;
  highlight: string;
  borderWidth: number; // px, 1..4
  radius: number; // px, 0..20
  mood: ThemeMood;
  background: BackgroundStyle;
  font: FontId;
}

/** Precomputed application payload (what gets persisted + replayed pre-paint). */
export interface AppliedTheme {
  name: string;
  dataset: { bg: BackgroundStyle; mood: ThemeMood; font: FontId };
  vars: Record<string, string>;
}
```

- [ ] **Step 2: Write the failing test** `lib/themeTokens.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, relativeLuminance, themeSpecSchema } from "@/lib/themeTokens";

describe("color helpers", () => {
  it("parses #rrggbb to rgb", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });
  it("computes contrast: black on white is 21", () => {
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
  });
  it("luminance of white > luminance of black", () => {
    expect(relativeLuminance("#ffffff")).toBeGreaterThan(relativeLuminance("#000000"));
  });
});

describe("themeSpecSchema", () => {
  const good = {
    name: "Test", paper: "#ffffff", paper2: "#f0f0f0", ink: "#111111", stroke: "#111111",
    accent: "#2f43ff", accent2: "#5b6bff", warn: "#ff4a2e", highlight: "#ffc93c",
    borderWidth: 3, radius: 0, mood: "bold", background: "dots", font: "zine",
  };
  it("accepts a valid spec", () => {
    expect(themeSpecSchema.safeParse(good).success).toBe(true);
  });
  it("rejects a bad hex and out-of-range radius", () => {
    expect(themeSpecSchema.safeParse({ ...good, paper: "red" }).success).toBe(false);
    expect(themeSpecSchema.safeParse({ ...good, radius: 99 }).success).toBe(false);
    expect(themeSpecSchema.safeParse({ ...good, font: "comic" }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/themeTokens.test.ts`
Expected: FAIL (module `@/lib/themeTokens` not found).

- [ ] **Step 4: Create `lib/themeTokens.ts` with helpers + schema**

```ts
import { z } from "zod";
import type { FontId, ThemeSpec } from "@/types";

const HEX = /^#[0-9a-fA-F]{6}$/;

export const FONT_IDS = ["zine", "space", "editorial", "terminal", "rounded", "impact"] as const;
const BG_STYLES = ["dots", "grid", "glow", "gradient", "solid"] as const;
const MOODS = ["bold", "sleek"] as const;

export const themeSpecSchema = z.object({
  name: z.string().trim().min(1).max(40),
  paper: z.string().regex(HEX),
  paper2: z.string().regex(HEX),
  ink: z.string().regex(HEX),
  stroke: z.string().regex(HEX),
  accent: z.string().regex(HEX),
  accent2: z.string().regex(HEX),
  warn: z.string().regex(HEX),
  highlight: z.string().regex(HEX),
  borderWidth: z.number().int().min(1).max(4),
  radius: z.number().int().min(0).max(20),
  mood: z.enum(MOODS),
  background: z.enum(BG_STYLES),
  font: z.enum(FONT_IDS),
});

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function toHex(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function channelLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/themeTokens.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add types/index.ts lib/themeTokens.ts lib/themeTokens.test.ts
git commit -m "feat(theme): ThemeSpec types, Zod schema, color/contrast helpers"
```

---

### Task 2: `ensureReadable` — auto-fix contrast

**Files:**
- Modify: `lib/themeTokens.ts`
- Test: `lib/themeTokens.test.ts`

**Interfaces:**
- Consumes: `hexToRgb`, `rgbToHex`, `contrastRatio`, `relativeLuminance`.
- Produces: `ensureReadable(spec: ThemeSpec): ThemeSpec`. Guarantees `contrastRatio(ink,paper) >= 4.5`, `contrastRatio(accent,paper) >= 3`, `contrastRatio(paper2,paper) >= 1.06`.

- [ ] **Step 1: Add the failing tests**

```ts
import { ensureReadable } from "@/lib/themeTokens";

describe("ensureReadable", () => {
  const base = {
    name: "T", paper: "#ffffff", paper2: "#f0f0f0", ink: "#111111", stroke: "#111111",
    accent: "#2f43ff", accent2: "#5b6bff", warn: "#ff4a2e", highlight: "#ffc93c",
    borderWidth: 3, radius: 0, mood: "bold", background: "dots", font: "zine",
  } as const;

  it("leaves an already-readable spec unchanged", () => {
    expect(ensureReadable({ ...base })).toEqual(base);
  });
  it("fixes low ink/paper contrast", () => {
    const fixed = ensureReadable({ ...base, ink: "#eeeeee" }); // near-white on white
    expect(contrastRatio(fixed.ink, fixed.paper)).toBeGreaterThanOrEqual(4.5);
  });
  it("fixes low accent/paper contrast", () => {
    const fixed = ensureReadable({ ...base, accent: "#fdfdfd" });
    expect(contrastRatio(fixed.accent, fixed.paper)).toBeGreaterThanOrEqual(3);
  });
  it("separates paper2 from paper when identical", () => {
    const fixed = ensureReadable({ ...base, paper2: "#ffffff" });
    expect(contrastRatio(fixed.paper2, fixed.paper)).toBeGreaterThanOrEqual(1.06);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/themeTokens.test.ts`
Expected: FAIL (`ensureReadable` not exported).

- [ ] **Step 3: Implement `ensureReadable` (append to `lib/themeTokens.ts`)**

```ts
/** Nudge every channel of `hex` toward black (0) or white (255) by `pct` %. */
function nudge(hex: string, toward: "black" | "white", pct: number): string {
  const { r, g, b } = hexToRgb(hex);
  const target = toward === "white" ? 255 : 0;
  const f = pct / 100;
  return rgbToHex({
    r: r + (target - r) * f,
    g: g + (target - g) * f,
    b: b + (target - b) * f,
  });
}

/** Push `color` away from `bg` until it clears `min` contrast (or we run out). */
function pushForContrast(color: string, bg: string, min: number): string {
  let out = color;
  const toward = relativeLuminance(bg) > 0.5 ? "black" : "white";
  for (let i = 0; i < 24 && contrastRatio(out, bg) < min; i++) {
    out = nudge(out, toward, 8);
  }
  return out;
}

export function ensureReadable(spec: ThemeSpec): ThemeSpec {
  const out = { ...spec };
  // Body text must clear WCAG AA.
  out.ink = pushForContrast(out.ink, out.paper, 4.5);
  // Accent carries bold button/badge text (paper-colored) — needs solid contrast.
  out.accent = pushForContrast(out.accent, out.paper, 3);
  // Surface must be visibly distinct from the page.
  if (contrastRatio(out.paper2, out.paper) < 1.06) {
    const toward = relativeLuminance(out.paper) > 0.5 ? "black" : "white";
    for (let i = 0; i < 12 && contrastRatio(out.paper2, out.paper) < 1.06; i++) {
      out.paper2 = nudge(out.paper2, toward, 4);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/themeTokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add lib/themeTokens.ts lib/themeTokens.test.ts
git commit -m "feat(theme): ensureReadable contrast guard with auto-fix"
```

---

### Task 3: `themeToCssVars` + `themeToPayload` + `CSS_VAR_KEYS`

**Files:**
- Modify: `lib/themeTokens.ts`
- Test: `lib/themeTokens.test.ts`

**Interfaces:**
- Produces: `themeToCssVars(spec):Record<string,string>`, `themeToPayload(spec):AppliedTheme`, `CSS_VAR_KEYS: readonly string[]`.

- [ ] **Step 1: Add failing tests**

```ts
import { CSS_VAR_KEYS, themeToCssVars, themeToPayload } from "@/lib/themeTokens";

const spec = {
  name: "T", paper: "#0b0b0b", paper2: "#161616", ink: "#eeeeee", stroke: "#333333",
  accent: "#5ce0ff", accent2: "#7c86ff", warn: "#ff6b6b", highlight: "#ffd27a",
  borderWidth: 1, radius: 14, mood: "sleek", background: "grid", font: "space",
} as const;

describe("themeToCssVars", () => {
  it("maps colors and structure to CSS variables", () => {
    const v = themeToCssVars(spec);
    expect(v["--paper"]).toBe("#0b0b0b");
    expect(v["--paper-2"]).toBe("#161616");
    expect(v["--red"]).toBe("#ff6b6b");
    expect(v["--yellow"]).toBe("#ffd27a");
    expect(v["--bw"]).toBe("1px");
    expect(v["--radius"]).toBe("14px");
    expect(v["--shadow"]).toContain("inset"); // sleek = soft glow shadow
  });
  it("bold mood uses a hard offset shadow", () => {
    expect(themeToCssVars({ ...spec, mood: "bold" })["--shadow"]).toContain("0 0 var(--stroke)");
  });
  it("CSS_VAR_KEYS lists exactly the keys produced", () => {
    expect(new Set(Object.keys(themeToCssVars(spec)))).toEqual(new Set(CSS_VAR_KEYS));
  });
});

describe("themeToPayload", () => {
  it("packages dataset + vars", () => {
    const p = themeToPayload(spec);
    expect(p.dataset).toEqual({ bg: "grid", mood: "sleek", font: "space" });
    expect(p.vars["--accent"]).toBe("#5ce0ff");
    expect(p.name).toBe("T");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/themeTokens.test.ts`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement (append to `lib/themeTokens.ts`)**

```ts
import type { AppliedTheme } from "@/types";

const BOLD_SHADOWS = {
  "--shadow": "5px 5px 0 0 var(--stroke)",
  "--shadow-lg": "8px 8px 0 0 var(--stroke)",
  "--shadow-btn": "4px 4px 0 0 var(--stroke)",
} as const;

const SLEEK_SHADOWS = {
  "--shadow": "0 14px 40px -20px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.04)",
  "--shadow-lg": "0 30px 70px -28px rgba(0,0,0,0.92), inset 0 1px 0 rgba(255,255,255,0.05)",
  "--shadow-btn": "0 10px 26px -14px rgba(0,0,0,0.7)",
} as const;

export const CSS_VAR_KEYS = [
  "--paper", "--paper-2", "--ink", "--stroke", "--accent", "--accent-2",
  "--red", "--yellow", "--bw", "--radius", "--shadow", "--shadow-lg", "--shadow-btn",
] as const;

export function themeToCssVars(spec: ThemeSpec): Record<string, string> {
  return {
    "--paper": spec.paper,
    "--paper-2": spec.paper2,
    "--ink": spec.ink,
    "--stroke": spec.stroke,
    "--accent": spec.accent,
    "--accent-2": spec.accent2,
    "--red": spec.warn,
    "--yellow": spec.highlight,
    "--bw": `${spec.borderWidth}px`,
    "--radius": `${spec.radius}px`,
    ...(spec.mood === "sleek" ? SLEEK_SHADOWS : BOLD_SHADOWS),
  };
}

export function themeToPayload(spec: ThemeSpec): AppliedTheme {
  return {
    name: spec.name,
    dataset: { bg: spec.background, mood: spec.mood, font: spec.font },
    vars: themeToCssVars(spec),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/themeTokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add lib/themeTokens.ts lib/themeTokens.test.ts
git commit -m "feat(theme): themeToCssVars + themeToPayload token mapping"
```

---

### Task 4: Built-in presets

**Files:**
- Modify: `lib/themeTokens.ts`
- Test: `lib/themeTokens.test.ts`

**Interfaces:**
- Produces: `PRESETS: Record<PresetId, ThemeSpec>`, `PRESET_ORDER: PresetId[]`, `type PresetId`.

- [ ] **Step 1: Add failing tests**

```ts
import { PRESETS, PRESET_ORDER, themeSpecSchema, ensureReadable, contrastRatio } from "@/lib/themeTokens";

describe("PRESETS", () => {
  it("every preset is schema-valid and already readable", () => {
    for (const id of PRESET_ORDER) {
      const spec = PRESETS[id];
      expect(themeSpecSchema.safeParse(spec).success).toBe(true);
      expect(ensureReadable(spec)).toEqual(spec); // no fix needed
      expect(contrastRatio(spec.ink, spec.paper)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/themeTokens.test.ts`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement (append to `lib/themeTokens.ts`)**

```ts
export type PresetId = "pikachu" | "charizard" | "jojo";

export const PRESETS: Record<PresetId, ThemeSpec> = {
  pikachu: {
    name: "Pikachu", paper: "#fffdf0", paper2: "#fff6cf", ink: "#241d05", stroke: "#241d05",
    accent: "#d4351f", accent2: "#f7c700", warn: "#d4351f", highlight: "#ffe14d",
    borderWidth: 3, radius: 6, mood: "bold", background: "dots", font: "rounded",
  },
  charizard: {
    name: "Charizard", paper: "#17110d", paper2: "#241a13", ink: "#f7ede2", stroke: "#3a2a20",
    accent: "#ff6a1f", accent2: "#ffb020", warn: "#ff4a2e", highlight: "#ffd27a",
    borderWidth: 1, radius: 12, mood: "sleek", background: "glow", font: "impact",
  },
  jojo: {
    name: "JoJo", paper: "#12101a", paper2: "#221a2e", ink: "#f3e9ff", stroke: "#3a2b4d",
    accent: "#ff2e88", accent2: "#b06bff", warn: "#ff5470", highlight: "#ffd84d",
    borderWidth: 2, radius: 4, mood: "sleek", background: "gradient", font: "impact",
  },
};

export const PRESET_ORDER: PresetId[] = ["pikachu", "charizard", "jojo"];
```

- [ ] **Step 4: Run to verify it passes** (if any preset fails contrast, adjust its `ink`/`paper` until green)

Run: `npx vitest run lib/themeTokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add lib/themeTokens.ts lib/themeTokens.test.ts
git commit -m "feat(theme): built-in Pikachu/Charizard/JoJo presets"
```

---

### Task 5: `generateTheme` service (Gemini)

**Files:**
- Create: `services/themeAgent.ts`
- Test: `services/themeAgent.test.ts`

**Interfaces:**
- Consumes: `generateJson` from `@/lib/gemini`; `themeSpecSchema`, `ensureReadable` from `@/lib/themeTokens`.
- Produces: `generateTheme(prompt: string): Promise<ThemeSpec>`. Throws the same `RateLimitedError`/`MissingApiKeyError` as `generateJson`. Throws `ThemeGenerationError` when the model output can't be parsed into a valid spec.

- [ ] **Step 1: Write the failing test** `services/themeAgent.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateJson = vi.fn();
vi.mock("@/lib/gemini", () => ({
  generateJson: (...args: unknown[]) => generateJson(...args),
  RateLimitedError: class RateLimitedError extends Error {},
  MissingApiKeyError: class MissingApiKeyError extends Error {},
}));

import { ThemeGenerationError, generateTheme } from "@/services/themeAgent";
import { contrastRatio } from "@/lib/themeTokens";

const raw = {
  name: "Charizard", paper: "#17110d", paper2: "#241a13", ink: "#f7ede2", stroke: "#3a2a20",
  accent: "#ff6a1f", accent2: "#ffb020", warn: "#ff4a2e", highlight: "#ffd27a",
  borderWidth: 1, radius: 12, mood: "sleek", background: "glow", font: "impact",
};

describe("generateTheme", () => {
  beforeEach(() => generateJson.mockReset());

  it("returns a validated spec", async () => {
    generateJson.mockResolvedValue(raw);
    const spec = await generateTheme("charizard");
    expect(spec.name).toBe("Charizard");
    expect(spec.font).toBe("impact");
  });

  it("repairs unreadable model output", async () => {
    generateJson.mockResolvedValue({ ...raw, ink: "#1a1a1a" }); // dark ink on dark paper
    const spec = await generateTheme("charizard");
    expect(contrastRatio(spec.ink, spec.paper)).toBeGreaterThanOrEqual(4.5);
  });

  it("throws ThemeGenerationError on unparseable output", async () => {
    generateJson.mockResolvedValue({ nonsense: true });
    await expect(generateTheme("x")).rejects.toBeInstanceOf(ThemeGenerationError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run services/themeAgent.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `services/themeAgent.ts`**

```ts
import { generateJson } from "@/lib/gemini";
import { FONT_IDS, ensureReadable, themeSpecSchema } from "@/lib/themeTokens";
import type { ThemeSpec } from "@/types";

/** The model returned something we could not turn into a valid ThemeSpec. */
export class ThemeGenerationError extends Error {
  constructor() {
    super("Couldn't design a theme from that. Try describing a vibe, color, or character.");
    this.name = "ThemeGenerationError";
  }
}

const THEME_SYSTEM = `You are a bold UI theme designer for a debate app. Given a short "vibe" (a character, mood, color, franchise, or aesthetic), design a cohesive, striking theme.

Return ONLY JSON matching exactly this shape:
{
  "name": string (<= 40 chars, the vibe's name),
  "paper": "#rrggbb" (page background),
  "paper2": "#rrggbb" (slightly different surface/card color),
  "ink": "#rrggbb" (main text — MUST be highly readable on paper),
  "stroke": "#rrggbb" (borders),
  "accent": "#rrggbb" (primary accent; bold text sits ON it, so it must contrast with paper),
  "accent2": "#rrggbb" (a second accent that pairs with accent for gradients),
  "warn": "#rrggbb" (error/alert red-ish),
  "highlight": "#rrggbb" (a highlighter color),
  "borderWidth": 1..4 (thin=sleek, thick=bold),
  "radius": 0..20 (0=sharp, high=rounded),
  "mood": "bold" (hard offset shadows, punchy) or "sleek" (soft glowing shadows, glassy),
  "background": one of "dots" | "grid" | "glow" | "gradient" | "solid",
  "font": one of ${FONT_IDS.map((f) => `"${f}"`).join(" | ")}
}

Font guide: zine=chunky editorial; space=techy; editorial=dramatic serif; terminal=hacker/mono; rounded=playful/cute; impact=heavy condensed/dramatic.

Rules:
- Commit to a dominant color with sharp accents — avoid timid, evenly-gray palettes.
- Guarantee strong contrast: dark ink on light paper, or light ink on dark paper. Never low-contrast text.
- Pick mood/background/font that genuinely match the vibe.
- Output ONLY the JSON object. No prose, no markdown.`;

export async function generateTheme(prompt: string): Promise<ThemeSpec> {
  const raw = await generateJson({
    system: THEME_SYSTEM,
    prompt: `Vibe: ${prompt.trim()}`,
    maxOutputTokens: 1024,
  });
  const parsed = themeSpecSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("themeAgent: invalid spec", parsed.error.message);
    throw new ThemeGenerationError();
  }
  return ensureReadable(parsed.data);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run services/themeAgent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add services/themeAgent.ts services/themeAgent.test.ts
git commit -m "feat(theme): generateTheme service (Gemini + schema + readability)"
```

---

### Task 6: `/api/theme` route

**Files:**
- Create: `app/api/theme/route.ts`
- Test: `app/api/theme/route.test.ts`

**Interfaces:**
- Consumes: `generateTheme` (mocked in test), `RateLimitedError`/`MissingApiKeyError` from `@/lib/gemini`, `ThemeGenerationError` from the service.
- Produces: `POST(req: Request): Promise<Response>` returning `{ spec }` (200), or `{ error }` with 400 / 429 / 500.

- [ ] **Step 1: Write the failing test** `app/api/theme/route.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";

const generateTheme = vi.fn();
vi.mock("@/services/themeAgent", () => ({
  generateTheme: (...a: unknown[]) => generateTheme(...a),
  ThemeGenerationError: class ThemeGenerationError extends Error {},
}));

import { POST } from "@/app/api/theme/route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/theme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/theme", () => {
  it("400s on an empty prompt", async () => {
    const res = await POST(post({ prompt: "" }));
    expect(res.status).toBe(400);
  });
  it("returns the generated spec", async () => {
    generateTheme.mockResolvedValue({ name: "Neo" });
    const res = await POST(post({ prompt: "matrix" }));
    expect(res.status).toBe(200);
    expect((await res.json()).spec.name).toBe("Neo");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/api/theme/route.test.ts`
Expected: FAIL (route not found).

- [ ] **Step 3: Implement `app/api/theme/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { MissingApiKeyError, RateLimitedError } from "@/lib/gemini";
import { ThemeGenerationError, generateTheme } from "@/services/themeAgent";

// One Gemini call; the global throttle in lib/gemini smooths load across users.
export const maxDuration = 30;

const requestSchema = z.object({ prompt: z.string().trim().min(1).max(120) });

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Describe a theme in a few words." }, { status: 400 });
  }

  try {
    const spec = await generateTheme(parsed.data.prompt);
    return NextResponse.json({ spec });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof ThemeGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    console.error("theme route failed", err);
    return NextResponse.json({ error: "Theme design failed. Try again." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/api/theme/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add app/api/theme/route.ts app/api/theme/route.test.ts
git commit -m "feat(theme): thin /api/theme route"
```

---

### Task 7: `lib/theme.ts` — apply / persist / store

**Files:**
- Create: `lib/theme.ts`
- Test: `lib/theme.test.ts`

**Interfaces:**
- Consumes: `themeToPayload`, `CSS_VAR_KEYS` from `@/lib/themeTokens`; types `ThemeSpec`, `AppliedTheme`.
- Produces: `applyPayload(payload, root)`, `applyTheme(spec)`, `applyBuiltin(id)`, and store fns `subscribeTheme`, `getThemeSnapshot`, `getThemeServerSnapshot`. `root` defaults to `document.documentElement`; tests pass a fake.

- [ ] **Step 1: Write the failing test** `lib/theme.test.ts` (a fake root — no jsdom needed)

```ts
import { describe, expect, it } from "vitest";
import { applyPayload, type ThemeRoot } from "@/lib/theme";
import { themeToPayload } from "@/lib/themeTokens";

function fakeRoot() {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  const root: ThemeRoot = {
    setAttribute: (k, v) => void (attrs[k] = v),
    removeAttribute: (k) => void delete attrs[k],
    style: {
      setProperty: (k, v) => void (props[k] = v),
      removeProperty: (k) => void delete props[k],
    },
  };
  return { root, attrs, props };
}

const spec = {
  name: "T", paper: "#0b0b0b", paper2: "#161616", ink: "#eeeeee", stroke: "#333333",
  accent: "#5ce0ff", accent2: "#7c86ff", warn: "#ff6b6b", highlight: "#ffd27a",
  borderWidth: 1, radius: 14, mood: "sleek", background: "grid", font: "space",
} as const;

describe("applyPayload", () => {
  it("writes data-* attributes and CSS variables to the root", () => {
    const { root, attrs, props } = fakeRoot();
    applyPayload(themeToPayload(spec), root);
    expect(attrs["data-theme"]).toBe("custom");
    expect(attrs["data-bg"]).toBe("grid");
    expect(attrs["data-mood"]).toBe("sleek");
    expect(attrs["data-font"]).toBe("space");
    expect(props["--accent"]).toBe("#5ce0ff");
    expect(props["--radius"]).toBe("14px");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/theme.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/theme.ts`**

```ts
import { CSS_VAR_KEYS, themeToPayload } from "@/lib/themeTokens";
import type { AppliedTheme, ThemeSpec } from "@/types";

/** Minimal surface of documentElement we touch — lets tests pass a fake. */
export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  style: { setProperty(k: string, v: string): void; removeProperty(k: string): void };
}

const THEME_KEY = "lbl-theme";
const CUSTOM_KEY = "lbl-custom-theme";

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
/** Returns "rostrum" | "cut" | the custom theme's name. */
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/theme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add lib/theme.ts lib/theme.test.ts
git commit -m "feat(theme): apply/persist theme + external store"
```

---

### Task 8: Fonts, pre-paint script, and custom-theme CSS

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: 8 font CSS variables on `<html>`; a generic pre-paint loader; `[data-font=…]` and `[data-theme="custom"]` CSS. No automated test (fonts/CSS) — verified via build + browser.

- [ ] **Step 1: Rewrite the font imports + html in `app/layout.tsx`**

Replace the two font imports with eight, give the current families new variable names, and set `preload: false` on all but the default pair:

```tsx
import {
  Archivo, Baloo_2, Bricolage_Grotesque, DM_Mono, Fraunces,
  JetBrains_Mono, Space_Grotesk, Space_Mono,
} from "next/font/google";

const zine = Bricolage_Grotesque({ variable: "--font-zine", subsets: ["latin"] });
const zineMono = DM_Mono({ variable: "--font-zine-mono", subsets: ["latin"], weight: ["400", "500"] });
const space = Space_Grotesk({ variable: "--font-space", subsets: ["latin"], preload: false });
const spaceMono = Space_Mono({ variable: "--font-space-mono", subsets: ["latin"], weight: ["400", "700"], preload: false });
const editorial = Fraunces({ variable: "--font-editorial", subsets: ["latin"], preload: false });
const terminal = JetBrains_Mono({ variable: "--font-terminal", subsets: ["latin"], preload: false });
const rounded = Baloo_2({ variable: "--font-rounded", subsets: ["latin"], preload: false });
const impact = Archivo({ variable: "--font-impact", subsets: ["latin"], weight: ["800", "900"], preload: false });

const fontVars = [zine, zineMono, space, spaceMono, editorial, terminal, rounded, impact]
  .map((f) => f.variable)
  .join(" ");
```

Update `<html>` to use `className={\`${fontVars} h-full antialiased\`}` (keep `data-theme="rostrum"` and `lang`).

- [ ] **Step 2: Replace the pre-paint `<script>` with the generic loader** (in `app/layout.tsx` `<head>`)

```tsx
<script
  dangerouslySetInnerHTML={{
    __html:
      "(function(){try{var t=localStorage.getItem('lbl-theme');if(!t)return;var r=document.documentElement;" +
      "if(t==='custom'){var raw=localStorage.getItem('lbl-custom-theme');if(!raw)return;var p=JSON.parse(raw);" +
      "r.setAttribute('data-theme','custom');if(p.dataset){r.setAttribute('data-bg',p.dataset.bg);" +
      "r.setAttribute('data-mood',p.dataset.mood);r.setAttribute('data-font',p.dataset.font);}" +
      "if(p.vars){for(var k in p.vars){r.style.setProperty(k,p.vars[k]);}}}else{r.setAttribute('data-theme',t);}}catch(e){}})();",
  }}
/>
```

- [ ] **Step 3: Add font defaults + `[data-font]` rules to `app/globals.css`** (after the `@theme inline` block)

```css
/* Font pairs — the theme agent switches these via data-font on <html>. */
:root { --font-display: var(--font-zine); --font-mono: var(--font-zine-mono); }
[data-font="zine"]     { --font-display: var(--font-zine);     --font-mono: var(--font-zine-mono); }
[data-font="space"]    { --font-display: var(--font-space);    --font-mono: var(--font-space-mono); }
[data-font="editorial"]{ --font-display: var(--font-editorial);--font-mono: var(--font-zine-mono); }
[data-font="terminal"] { --font-display: var(--font-terminal); --font-mono: var(--font-terminal); }
[data-font="rounded"]  { --font-display: var(--font-rounded);  --font-mono: var(--font-zine-mono); }
[data-font="impact"]   { --font-display: var(--font-impact);   --font-mono: var(--font-zine-mono); }
```

- [ ] **Step 4: Add custom-theme background + mood CSS to `app/globals.css`** (near the other `[data-theme]` blocks)

```css
/* ---- CUSTOM (agent-generated) themes: color via inline vars; texture here ---- */
[data-theme="custom"][data-bg="dots"] body {
  background-image: radial-gradient(color-mix(in srgb, var(--ink) 10%, transparent) 1.4px, transparent 1.4px);
  background-size: 22px 22px; background-position: -11px -11px;
}
[data-theme="custom"][data-bg="grid"] body {
  background-image:
    linear-gradient(color-mix(in srgb, var(--ink) 7%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--ink) 7%, transparent) 1px, transparent 1px);
  background-size: 46px 46px, 46px 46px;
}
[data-theme="custom"][data-bg="gradient"] body {
  background-image: linear-gradient(160deg, color-mix(in srgb, var(--accent) 16%, var(--paper)), var(--paper) 62%);
}
[data-theme="custom"][data-bg="solid"] body { background-image: none; }
[data-theme="custom"][data-bg="glow"] body::before {
  content: ""; position: fixed; inset: -25%; z-index: -1; pointer-events: none;
  background:
    radial-gradient(38% 38% at 22% 18%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 62%),
    radial-gradient(40% 40% at 82% 26%, color-mix(in srgb, var(--accent-2) 22%, transparent), transparent 62%),
    radial-gradient(46% 46% at 50% 92%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 62%);
  animation: aurora 22s ease-in-out infinite alternate;
}

/* Sleek mood reinterprets the shared blocks (mirrors [data-theme="cut"]). */
[data-theme="custom"][data-mood="sleek"] .frame {
  backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3);
}
[data-theme="custom"][data-mood="sleek"] .bg-accent {
  background-image: linear-gradient(135deg, var(--accent), var(--accent-2));
}
[data-theme="custom"][data-mood="sleek"] .btn-press:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 30px -10px rgba(0,0,0,0.7), 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
  filter: brightness(1.05);
}
[data-theme="custom"][data-mood="sleek"] li.frame:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  box-shadow: var(--shadow-lg), 0 0 34px -6px color-mix(in srgb, var(--accent) 40%, transparent);
}

/* Bold mood: hard offset press (mirrors [data-theme="rostrum"]). */
[data-theme="custom"][data-mood="bold"] .btn-press:hover:not(:disabled) {
  transform: translate(1px, 1px); box-shadow: 3px 3px 0 0 var(--stroke);
}
[data-theme="custom"][data-mood="bold"] .btn-press:active:not(:disabled) {
  transform: translate(4px, 4px); box-shadow: 0 0 0 0 var(--stroke);
}
```

- [ ] **Step 5: Verify build + pre-paint manually**

Run: `npm run build` — expect success (all 8 fonts resolve, no type errors).
Then `npm run dev`, open the app, and in devtools console run:
```
localStorage.setItem('lbl-theme','custom');
localStorage.setItem('lbl-custom-theme', JSON.stringify({name:'Charizard',dataset:{bg:'glow',mood:'sleek',font:'impact'},vars:{'--paper':'#17110d','--paper-2':'#241a13','--ink':'#f7ede2','--stroke':'#3a2a20','--accent':'#ff6a1f','--accent-2':'#ffb020','--red':'#ff4a2e','--yellow':'#ffd27a','--bw':'1px','--radius':'12px','--shadow':'0 14px 40px -20px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.04)','--shadow-lg':'0 30px 70px -28px rgba(0,0,0,0.92), inset 0 1px 0 rgba(255,255,255,0.05)','--shadow-btn':'0 10px 26px -14px rgba(0,0,0,0.7)'}}));
location.reload();
```
Expected: page loads already dark/orange (Charizard), heavy Archivo headings, aurora glow — **with no flash of the default theme**. Reset with `localStorage.clear(); location.reload()`.

- [ ] **Step 6: Commit**

```
git add app/layout.tsx app/globals.css
git commit -m "feat(theme): curated fonts, generic pre-paint loader, custom-theme CSS"
```

---

### Task 9: `ThemeStudio` UI + wire into the page

**Files:**
- Create: `components/ThemeStudio.tsx`
- Modify: `lib/apiClient.ts` (add `requestTheme`)
- Modify: `app/page.tsx` (swap component)
- Delete: `components/ThemeSwitcher.tsx`

**Interfaces:**
- Consumes: `applyTheme`, `applyBuiltin`, `subscribeTheme`, `getThemeSnapshot`, `getThemeServerSnapshot` from `@/lib/theme`; `PRESETS`, `PRESET_ORDER` from `@/lib/themeTokens`; `requestTheme` from `@/lib/apiClient`.
- Produces: default-exported `ThemeStudio` React component.

- [ ] **Step 1: Add `requestTheme` to `lib/apiClient.ts`**

```ts
import type { ThemeSpec } from "@/types";

export type ThemeOutcome = { ok: true; spec: ThemeSpec } | { ok: false; error: string };

/** Ask the theme agent to design a theme from a vibe. */
export async function requestTheme(prompt: string): Promise<ThemeOutcome> {
  try {
    const res = await fetch("/api/theme", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (!res.ok || !data.spec) {
      return { ok: false, error: data.error ?? "Theme design failed. Try again." };
    }
    return { ok: true, spec: data.spec };
  } catch {
    return { ok: false, error: "Could not reach the server. Is it running?" };
  }
}
```
(Uses the existing private `apiHeaders()` in that file.)

- [ ] **Step 2: Create `components/ThemeStudio.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useSyncExternalStore } from "react";
import { requestTheme } from "@/lib/apiClient";
import { applyBuiltin, applyTheme, getThemeServerSnapshot, getThemeSnapshot, subscribeTheme } from "@/lib/theme";
import { PRESETS, PRESET_ORDER } from "@/lib/themeTokens";

export default function ThemeStudio() {
  const active = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="label-mono frame btn-press bg-paper-2 px-3 py-1.5 text-[10px] font-bold text-ink hover:text-accent"
      >
        ✨ {active}
      </button>

      {open && (
        <div className="frame shadow-hard absolute right-0 z-20 mt-2 w-64 bg-paper-2 p-3">
          <p className="label-mono mb-2 text-[10px] text-ink/60">Base</p>
          <div className="mb-3 flex gap-2">
            <button type="button" onClick={() => applyBuiltin("rostrum")} className="btn-press frame flex-1 bg-paper px-2 py-1 text-xs font-bold hover:text-accent">Bold</button>
            <button type="button" onClick={() => applyBuiltin("cut")} className="btn-press frame flex-1 bg-paper px-2 py-1 text-xs font-bold hover:text-accent">Dark</button>
          </div>

          <p className="label-mono mb-2 text-[10px] text-ink/60">Presets</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {PRESET_ORDER.map((id) => (
              <button key={id} type="button" onClick={() => applyTheme(PRESETS[id])} className="btn-press frame bg-paper px-2 py-1 text-xs font-bold hover:text-accent">
                {PRESETS[id].name}
              </button>
            ))}
          </div>

          <p className="label-mono mb-2 text-[10px] text-ink/60">Design your own</p>
          <div className="flex gap-2">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void generate(); }}
              placeholder="e.g. vaporwave, Charizard…"
              className="frame w-full bg-paper px-2 py-1 text-xs font-medium text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
            />
            <button type="button" disabled={busy || !prompt.trim()} onClick={() => void generate()} className="btn-press frame bg-accent px-2 py-1 text-xs font-bold text-paper disabled:opacity-60">
              {busy ? "…" : "Go"}
            </button>
          </div>
          {error && <p role="alert" className="mt-2 text-[11px] font-semibold text-red">{error}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Swap the component in `app/page.tsx`**

Replace `import ThemeSwitcher from "@/components/ThemeSwitcher";` with `import ThemeStudio from "@/components/ThemeStudio";`, and `<ThemeSwitcher />` with `<ThemeStudio />`.

- [ ] **Step 4: Delete the old switcher**

```
git rm components/ThemeSwitcher.tsx
```

- [ ] **Step 5: Type-check, lint, build**

Run: `npx tsc --noEmit` — expect clean.
Run: `npx eslint components/ThemeStudio.tsx lib/apiClient.ts app/page.tsx` — expect clean.
Run: `npm run build` — expect success.

- [ ] **Step 6: Manual browser verification** (`npm run dev`)
  - Click **✨** → popover opens. Click **Charizard** → whole app recolors instantly; Coach/Find/Cut tabs all look right.
  - Type "vaporwave" → **Go** → a generated theme applies and text stays readable.
  - **Reload** → the generated theme persists with no flash.
  - Click **Bold** → returns to default; reload → stays Bold (custom vars cleared).
  - (If `GEMINI_API_KEY` absent or rate-limited, presets/Bold/Dark still work; generate shows the error.)

- [ ] **Step 7: Commit**

```
git add components/ThemeStudio.tsx app/page.tsx lib/apiClient.ts
git commit -m "feat(theme): ThemeStudio popover (presets + generate), replace ThemeSwitcher"
```

---

### Task 10: Full verification, docs, deploy

**Files:**
- Modify: `AGENTS.md` (Current State), `MEMORY.md` (pointer), `.env.example` (feature note only).

- [ ] **Step 1: Run the whole suite**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run && npm run build`
Expected: type-clean, lint-clean, all tests pass (Task 1–7 added ~ a dozen), build OK with route `/api/theme`.

- [ ] **Step 2: Live smoke test** — `npm run start -p 3210`, then generate a theme via the UI and confirm it applies + persists across reload; confirm a preset works with `GEMINI_API_KEY` unset.

- [ ] **Step 3: Add a one-line note to `.env.example`** under the Gemini key: `# Also powers the Theme agent (generate a UI theme from a vibe).` (No new variable.)

- [ ] **Step 4: Update `AGENTS.md` Current State** — note the Theme agent (visual-only) shipped; and add a `MEMORY.md` pointer line.

- [ ] **Step 5: Commit + push**

```
git add AGENTS.md MEMORY.md .env.example
git commit -m "docs(theme): record theme agent in project state"
git push origin main
```
(Push triggers the Vercel deploy. No new env vars needed — reuses GEMINI_API_KEY.)

---

## Self-Review

**Spec coverage:** ThemeSpec (T1) ✓ · readability guard (T2) ✓ · token/payload mapping (T3) ✓ · presets (T4) ✓ · AI service (T5) ✓ · route + error handling incl. 429/422/500 (T6) ✓ · apply/persist/no-flash + store (T7) ✓ · fonts + pre-paint + custom CSS incl. all 5 backgrounds & both moods (T8) ✓ · ThemeStudio UI incl. generate/presets/reset + rate-limit fallback (T9) ✓ · testing + docs + deploy (T10) ✓. Curated 6 fonts wired in T8/T3-schema ✓.

**Placeholder scan:** No TBD/TODO; every code step has real code; manual-verify steps list exact console/CLI commands.

**Type consistency:** `ThemeSpec`/`AppliedTheme`/`FontId` defined in T1, reused verbatim. `themeToCssVars`→`CSS_VAR_KEYS` set-equality asserted (T3) and consumed by `applyBuiltin` clear-loop (T7). `themeToPayload` shape (`{name,dataset,vars}`) matches the pre-paint loader (T8) and `applyPayload` (T7). `generateTheme(prompt)` signature identical in T5/T6. Route error classes (`RateLimitedError`, `MissingApiKeyError`, `ThemeGenerationError`) all defined/imported.

**Deviation from spec (intentional):** the pre-paint script is a *generic* payload loader (iterates stored `vars`) instead of duplicating the token mapping — this removes the drift risk the spec flagged, so the spec's "assert script equals mapping" test is unnecessary and omitted.
