import { z } from "zod";
import { generateJson } from "@/lib/gemini";
import { SKILL_TIERS, type DebaterProfile, type Round } from "@/types";

/**
 * The debater-profile agent: read ONE debater's own logged rounds + reports and
 * synthesize a private, debate-aware read on their skill level and recurring
 * patterns. One Gemini call; output schema-validated. This is stateless — it
 * only transforms the rounds it's given and returns the result; nothing is
 * stored server-side (personal data stays on the debater's device).
 *
 * RateLimitedError / MissingApiKeyError from generateJson bubble up to the route.
 */

/** The model returned something we couldn't turn into a valid profile. */
export class ProfileError extends Error {
  constructor() {
    super("Couldn't read your rounds well enough to build a profile. Add a bit more detail to your reports and try again.");
    this.name = "ProfileError";
  }
}

const profileSchema = z.object({
  skillTier: z.enum(SKILL_TIERS),
  summary: z.string().trim().min(1).max(600),
  strengths: z.array(z.string().trim().min(1).max(200)).max(6),
  weaknesses: z.array(z.string().trim().min(1).max(200)).max(6),
  focusAreas: z.array(z.string().trim().min(1).max(200)).max(6),
});

const SYSTEM = `You are an experienced Lincoln-Douglas debate coach. You are given ONE debater's own tournament rounds (side, result, and their own notes on why each round went the way it did). Build a short, private profile that will be used to personalize THIS debater's coaching — so be specific, honest, and debate-aware.

Return ONLY JSON matching exactly this shape:
{
  "skillTier": "Novice" | "Developing" | "Varsity" | "Circuit",
  "summary": string (1-2 sentences: where this debater is right now),
  "strengths": string[] (0-5 recurring strengths, each a short phrase),
  "weaknesses": string[] (0-5 recurring weaknesses to work on, each a short phrase),
  "focusAreas": string[] (0-5 concrete things to prep or drill next)
}

Rules:
- Ground EVERYTHING in the reports provided. Never invent specifics the notes don't support. If the notes are thin, keep it general and set a conservative tier.
- Be debate-aware: reference real LD concepts when the notes do (framework/value-criterion, links, impacts, permutations, theory, kritiks, solvency, rebuttal collapse, time allocation, clarity/speed, weighing, etc.).
- skillTier: Novice = new/learning fundamentals; Developing = local circuit, inconsistent; Varsity = solid regional competitor; Circuit = national-circuit caliber. Infer from win rate, opponents, and the sophistication of the notes.
- Keep each list item a short, actionable phrase (no full sentences).
- Output ONLY the JSON object. No prose, no markdown.`;

/** Compact one-round-per-line transcript for the model. */
function roundsTranscript(rounds: Round[]): string {
  return rounds
    .map((r, i) => {
      const head = `${i + 1}. ${r.tournament} ${r.roundLabel} — ${r.side}, ${r.result === "W" ? "Win" : "Loss"}`;
      return r.report.trim() ? `${head}: ${r.report.trim()}` : head;
    })
    .join("\n");
}

export async function generateProfile(rounds: Round[]): Promise<DebaterProfile> {
  const raw = await generateJson({
    system: SYSTEM,
    prompt: `Rounds (${rounds.length}):\n${roundsTranscript(rounds)}`,
    maxOutputTokens: 1024,
  });
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("debaterProfile: invalid profile", parsed.error.message);
    throw new ProfileError();
  }
  return parsed.data;
}
