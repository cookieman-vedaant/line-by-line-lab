import { z } from "zod";
import type { AppliedTheme, FontId, ThemeSpec } from "@/types";

/**
 * Pure token logic for the theme agent: the ThemeSpec schema, color/contrast
 * math, a readability guard, and the spec→CSS-variable mapping. No DOM, no
 * network — safe to import on client and server. DOM/storage glue lives in
 * lib/theme.ts; the AI call in services/themeAgent.ts.
 */

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

/**
 * Guarantee a theme is usable no matter what the AI returned: body text clears
 * WCAG AA on the page, the accent (which carries bold button/badge text) clears
 * a solid ratio, and the surface is visibly distinct from the page. Deterministic
 * and bounded; a spec that already passes is returned unchanged.
 */
export function ensureReadable(spec: ThemeSpec): ThemeSpec {
  const out = { ...spec };
  out.ink = pushForContrast(out.ink, out.paper, 4.5);
  out.accent = pushForContrast(out.accent, out.paper, 3);
  if (contrastRatio(out.paper2, out.paper) < 1.06) {
    const toward = relativeLuminance(out.paper) > 0.5 ? "black" : "white";
    for (let i = 0; i < 12 && contrastRatio(out.paper2, out.paper) < 1.06; i++) {
      out.paper2 = nudge(out.paper2, toward, 4);
    }
  }
  return out;
}

// ---- spec → CSS variables -------------------------------------------------

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

/** The exact custom properties themeToCssVars sets (used to clear them on reset). */
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

// ---- Built-in presets -----------------------------------------------------
// One-click themes (also the AI's few-shot vibe + a fallback when it's busy).
// Each is authored to already clear the readability thresholds.

export type PresetId = "pikachu" | "charizard" | "jojo";

export const PRESETS: Record<PresetId, ThemeSpec> = {
  pikachu: {
    name: "Pikachu", paper: "#fffdf0", paper2: "#ffe98a", ink: "#241d05", stroke: "#241d05",
    accent: "#d4351f", accent2: "#f7c700", warn: "#d4351f", highlight: "#ffe14d",
    borderWidth: 3, radius: 6, mood: "bold", background: "dots", font: "rounded",
  },
  charizard: {
    name: "Charizard", paper: "#17110d", paper2: "#2a1e16", ink: "#f7ede2", stroke: "#3a2a20",
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
