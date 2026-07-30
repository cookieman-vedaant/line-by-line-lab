import { z } from "zod";
import type { FontId, ThemeSpec } from "@/types";

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
