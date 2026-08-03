import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Account tiers. `profiles.tier` already existed as a column; this is the code
 * that finally gives it meaning.
 *
 * Tier drives two things and nothing else:
 *   1. WHICH MODEL runs each AI task (see lib/models.ts) — Pro gets the stronger,
 *      more expensive model on the calls where quality is actually visible.
 *   2. HOW MUCH you can run per day (see quotaFor below).
 *
 * It deliberately does NOT gate which TOOLS exist. Every debater gets the whole
 * workbench; Pro buys more of it and a better model behind it. That keeps the
 * free tier genuinely useful, which is the entire pitch of the product.
 */

export const TIERS = ["free", "pro"] as const;
export type Tier = (typeof TIERS)[number];

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/**
 * Daily ceilings per tier. These are the numbers that decide whether a paid plan
 * makes money, so they live in one place with the cost math beside them
 * (docs/adr/0002-ai-model-routing.md has the per-action token estimates).
 */
export interface TierQuota {
  /** Card cuts + re-highlights per day. The expensive calls. */
  cutsPerDay: number;
  /** Article searches per day. */
  searchesPerDay: number;
  /** Coach messages per day. Most expensive per action — it's multi-turn. */
  coachPerDay: number;
}

const QUOTAS: Record<Tier, TierQuota> = {
  // Sized so a debater can genuinely prep a round — the free tier has to be
  // useful or nobody sticks around long enough to upgrade.
  free: { cutsPerDay: 15, searchesPerDay: 20, coachPerDay: 25 },
  // "Uncapped" in the marketing sense: high enough that a real person never
  // touches it, low enough that one compromised account can't run up an
  // unbounded bill. Never remove the ceiling entirely.
  pro: { cutsPerDay: 300, searchesPerDay: 400, coachPerDay: 500 },
};

export function quotaFor(tier: Tier): TierQuota {
  return QUOTAS[tier];
}

/**
 * Read a user's tier. Defaults to "free" on ANY uncertainty — a missing row, an
 * unreadable column, a database hiccup. Failing closed matters here: the
 * opposite default would hand out Pro-priced model calls for free whenever the
 * database blinked.
 */
export async function getTier(supabase: SupabaseClient, userId: string): Promise<Tier> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("tier")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return "free";
    const value = (data as { tier?: unknown }).tier;
    return isTier(value) ? value : "free";
  } catch {
    return "free";
  }
}
