import type { NewRound } from "@/lib/roundLog";
import type { StoredProfile } from "@/lib/profileStore";
import type { Round } from "@/types";

/**
 * One-time bridge from the OLD local-first storage (pre-accounts) to the
 * account. Reads the legacy `localStorage` keys directly — the round/profile
 * stores no longer touch localStorage, so this is the only reader — so a debater
 * who logged rounds before signing up can import them into their account with
 * one click, then we clear the device copy.
 */

const ROUNDS_KEY = "lbl-rounds";
const PROFILE_KEY = "lbl-profile";

/** Rounds saved on this device before accounts, as import-ready NewRound[]. */
export function readLocalRounds(): NewRound[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ROUNDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return (parsed as Round[])
      .filter((r) => r && typeof r.tournament === "string" && typeof r.roundLabel === "string")
      .map((r) => ({
        tournament: r.tournament,
        roundLabel: r.roundLabel,
        side: r.side === "Neg" ? "Neg" : "Aff",
        result: r.result === "L" ? "L" : "W",
        opponent: typeof r.opponent === "string" && r.opponent ? r.opponent : undefined,
        report: typeof r.report === "string" ? r.report : "",
      }));
  } catch {
    return [];
  }
}

/** The AI profile cached on this device before accounts, if any. */
export function readLocalProfile(): StoredProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProfile;
    return parsed && parsed.profile ? parsed : null;
  } catch {
    return null;
  }
}

/** Remove the on-device copies once they've been imported into the account. */
export function clearLocalRoundData(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ROUNDS_KEY);
    window.localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}
