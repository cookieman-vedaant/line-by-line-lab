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

const THEME_SYSTEM = `You are a BOLD, opinionated UI theme designer for a debate app. Given a short "vibe" (a character, mood, color, franchise, or aesthetic), design a cohesive, striking theme that unmistakably reads as that vibe. Timid or generic output is a failure.

Return ONLY JSON matching exactly this shape:
{
  "name": string (<= 40 chars, the vibe's name),
  "paper": "#rrggbb" (page background),
  "paper2": "#rrggbb" (a clearly different surface/card color),
  "ink": "#rrggbb" (main text — MUST be highly readable on paper),
  "stroke": "#rrggbb" (borders),
  "accent": "#rrggbb" (primary accent; bold text sits ON it, so it must contrast with paper),
  "accent2": "#rrggbb" (a second accent that pairs with accent for gradients),
  "warn": "#rrggbb" (error/alert red-ish),
  "highlight": "#rrggbb" (a bright highlighter color),
  "borderWidth": 1..4 (thin=sleek/modern, thick=punchy/comic),
  "radius": 0..20 (0=sharp/techy, high=soft/playful),
  "mood": "bold" (hard offset shadows, punchy, poster-like) or "sleek" (soft glowing shadows, glassy, neon/futuristic),
  "background": one of "dots" | "grid" | "glow" | "gradient" | "solid",
  "font": one of ${FONT_IDS.map((f) => `"${f}"`).join(" | ")}
}

Font guide — ALWAYS pick the one that fits (do NOT default to "zine"):
- zine = chunky bold-poster grotesque (indie, editorial, punk)
- space = clean techy geometric (tech, sci-fi, minimalist-cool)
- editorial = dramatic high-contrast serif (elegant, retro, vaporwave, fashion, classical)
- terminal = monospace (hacker, code, matrix, cyberpunk, retro-computer)
- rounded = soft friendly rounded (playful, cute, kids, Pokémon, bubbly)
- impact = heavy condensed display (loud, dramatic, anime, sports, action)

HARD RULES:
- Commit to a DOMINANT color with sharp accent(s). No timid, evenly-gray, or washed-out palettes.
- Choose a distinctive font that matches the vibe — the font MUST change the feel, not stay default.
- Use an atmospheric background (dots/grid/glow/gradient) that fits; only use "solid" if the vibe is deliberately stark/minimal.
- Match mood to vibe: "bold" for comic/poster/retro/playful; "sleek" for neon/glassy/futuristic/dark.
- Guarantee strong contrast: dark ink on light paper, OR light ink on dark paper. Never low-contrast text.
- Output ONLY the JSON object. No prose, no markdown.

Worked examples (match this level of commitment):
- Vibe "JoJo's Bizarre Adventure" -> {"name":"JoJo","paper":"#1a0b2e","paper2":"#2d1147","ink":"#ffe8fb","stroke":"#52246e","accent":"#ff2f9e","accent2":"#ffd100","warn":"#ff477e","highlight":"#ffd100","borderWidth":2,"radius":2,"mood":"sleek","background":"gradient","font":"impact"}
- Vibe "the Matrix" -> {"name":"Matrix","paper":"#04120a","paper2":"#0a2015","ink":"#b9ffcf","stroke":"#164b2c","accent":"#22ff88","accent2":"#0aff9d","warn":"#ff5c5c","highlight":"#a6ff00","borderWidth":1,"radius":0,"mood":"sleek","background":"grid","font":"terminal"}
- Vibe "Pikachu" -> {"name":"Pikachu","paper":"#fff9db","paper2":"#ffe14d","ink":"#2b2000","stroke":"#2b2000","accent":"#e3350d","accent2":"#f5c518","warn":"#e3350d","highlight":"#ffd600","borderWidth":3,"radius":8,"mood":"bold","background":"dots","font":"rounded"}`;

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
