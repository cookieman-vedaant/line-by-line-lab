import type { Tier } from "@/lib/tier";

/**
 * ONE place that decides which Gemini model runs which task, per tier.
 *
 * Before this, model choice was two loose constants (GEMINI_MODEL and
 * GEMINI_MARKER_MODEL) which meant every task except card-marking silently ran
 * on the cheapest, weakest model — including the Coach, the most
 * reasoning-heavy thing in the app and the headline Pro feature.
 *
 * ── PRICING (per 1M tokens, Google's paid tier, checked Aug 2026) ────────────
 *   gemini-3.1-flash-lite   $0.25 in / $1.50 out    cheapest, weakest
 *   gemini-3.5-flash-lite   $0.30 in / $2.50 out    mid
 *   gemini-3.6-flash        $1.50 in / $7.50 out    strong
 *   gemini-3.5-flash        $1.50 in / $9.00 out    strong, STRICTLY WORSE VALUE
 *                                                   than 3.6-flash (same input
 *                                                   price, 20% dearer output)
 *
 * ── HOW MODEL CHOICE CHANGES QUALITY ────────────────────────────────────────
 * It doesn't move all tasks equally, which is the whole reason this file is a
 * per-task table rather than one global setting:
 *
 *   MECHANICAL tasks (expand a query, pick a paragraph range, emit a theme's
 *   colors) are near-deterministic. A bigger model produces the same answer for
 *   6-10x the price. Keep these on flash-lite forever.
 *
 *   JUDGEMENT tasks (rank which article actually supports a claim, choose which
 *   phrases to underline and highlight) degrade visibly on a weak model. The
 *   marker is the known case in this codebase: on a lite model it highlighted
 *   disconnected buzzwords instead of coherent warrants — the reason
 *   GEMINI_MARKER_MODEL was introduced at all.
 *
 *   AGENTIC tasks (the Coach: multi-turn, tool-calling, holding a whole case
 *   file in context) degrade the most. A weak model picks the wrong tool, loses
 *   the thread across turns, and misattributes sections of an uploaded file.
 *
 * ── THINKING ────────────────────────────────────────────────────────────────
 * `thinkingBudget: 0` is right for JSON extraction — a thinking model with a
 * small output cap spends the budget reasoning and truncates the JSON, which is
 * exactly how the card-length selector once broke. It is WRONG for the Coach,
 * whose value IS the reasoning and whose output is free text with no fragile
 * structure to truncate. So thinking is per-task here, not global.
 *
 * ── VERIFICATION REQUIRED BEFORE CHANGING A DEFAULT ─────────────────────────
 * Not every model ID works on every key with our config: some 404 ("not
 * available to new users"), others 400 against `thinkingConfig` + JSON output.
 * Only IDs proven on THIS key are defaults below. Run `npm run check:models` to
 * probe candidates before promoting one, and override via env — never guess.
 */

/** The distinct AI jobs in the app. Named for the work, not the service. */
export const AI_TASKS = [
  "expand", // search: claim -> query variants (mechanical)
  "rank", // search: order candidates by debate usefulness (judgement)
  "select", // cut: choose the paragraph range (mechanical)
  "mark", // cut/re-highlight: choose underlines + highlights (judgement, visible)
  "coach", // assistant: multi-turn agentic reasoning + tools
  "theme", // theme agent: emit a color/type spec (mechanical)
  "profile", // record: summarize rounds into a debater profile (judgement, light)
] as const;

export type AiTask = (typeof AI_TASKS)[number];

export interface ModelChoice {
  model: string;
  /** 0 disables thinking. Only raise it where output isn't fragile JSON. */
  thinkingBudget: number;
}

/** Verified working on this project's key (see MEMORY.md before adding more). */
const LITE = "gemini-3.1-flash-lite";
const STRONG = "gemini-3.5-flash";

/**
 * Per-task, per-tier defaults.
 *
 * Free tier keeps the strong model ONLY on `mark`, because that is the one
 * output a user looks at directly and judges the product by. Everything else
 * runs lite so the free tier stays affordable at scale.
 *
 * Pro upgrades the three judgement/agentic tasks. `coach` is the important one:
 * it was running on the WEAKEST model despite being the Pro headline feature.
 */
const DEFAULTS: Record<AiTask, Record<Tier, ModelChoice>> = {
  expand: { free: { model: LITE, thinkingBudget: 0 }, pro: { model: LITE, thinkingBudget: 0 } },
  select: { free: { model: LITE, thinkingBudget: 0 }, pro: { model: LITE, thinkingBudget: 0 } },
  theme: { free: { model: LITE, thinkingBudget: 0 }, pro: { model: LITE, thinkingBudget: 0 } },

  rank: { free: { model: LITE, thinkingBudget: 0 }, pro: { model: STRONG, thinkingBudget: 0 } },
  profile: { free: { model: LITE, thinkingBudget: 0 }, pro: { model: STRONG, thinkingBudget: 0 } },

  // Quality-critical on BOTH tiers: a lite marker highlights buzzwords.
  mark: { free: { model: STRONG, thinkingBudget: 0 }, pro: { model: STRONG, thinkingBudget: 0 } },

  // Free stays lite (Coach is the costliest action — it's multi-turn). Pro gets
  // the strong model AND thinking, since its output is prose, not fragile JSON.
  coach: { free: { model: LITE, thinkingBudget: 0 }, pro: { model: STRONG, thinkingBudget: 2048 } },
};

/**
 * Env override, checked most-specific first:
 *   GEMINI_MODEL_MARK_PRO  ->  GEMINI_MODEL_MARK  ->  built-in default
 * so a single task can be retuned in the Vercel dashboard without a deploy.
 */
function envModel(task: AiTask, tier: Tier): string | undefined {
  const t = task.toUpperCase();
  return (
    process.env[`GEMINI_MODEL_${t}_${tier.toUpperCase()}`] ||
    process.env[`GEMINI_MODEL_${t}`] ||
    undefined
  );
}

function envThinking(task: AiTask, tier: Tier): number | undefined {
  const t = task.toUpperCase();
  const raw =
    process.env[`GEMINI_THINKING_${t}_${tier.toUpperCase()}`] || process.env[`GEMINI_THINKING_${t}`];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/** Resolve the model + thinking budget for one task at one tier. */
export function modelFor(task: AiTask, tier: Tier = "free"): ModelChoice {
  const base = DEFAULTS[task][tier];
  return {
    model: envModel(task, tier) ?? base.model,
    thinkingBudget: envThinking(task, tier) ?? base.thinkingBudget,
  };
}

/**
 * The cheaper model to retry with when the primary fails transiently. Returns
 * null when the primary IS the fallback, so callers can skip a pointless retry.
 * Used by the marker: a 503 on the strong model costs ~30s of retries, while
 * dropping to lite answers immediately at slightly lower quality.
 */
export function fallbackFor(task: AiTask, tier: Tier = "free"): string | null {
  const primary = modelFor(task, tier).model;
  return primary === LITE ? null : LITE;
}
