import { generateJson } from "@/lib/gemini";
import { FONT_IDS, ensureReadable, themeSpecSchema } from "@/lib/themeTokens";
import type { ThemeSpec } from "@/types";

/**
 * The theme agent: turn a short "vibe" into a cohesive, readable ThemeSpec.
 * One Gemini call; output is schema-validated then passed through the
 * readability guard so an unreadable theme is impossible. RateLimitedError /
 * MissingApiKeyError from generateJson bubble up to the route.
 */

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
