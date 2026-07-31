import type { DebaterProfile, Round } from "@/types";

/**
 * Local-first cache of the AI debater profile. Like the Round Log, this is
 * PERSONAL data and lives only in the browser (`lbl-profile`) — never on the
 * server. We also store a signature of the rounds the profile was built from, so
 * the UI can tell the debater when their profile is out of date.
 *
 * Exposed as an external store (subscribe + snapshot) for useSyncExternalStore.
 */

const KEY = "lbl-profile";

export interface StoredProfile {
  profile: DebaterProfile;
  /** Signature of the rounds this profile was generated from (see roundsSignature). */
  signature: string;
  generatedAt: string;
}

// ---- pure helpers (unit-tested) ------------------------------------------

/** Tiny non-crypto hash (djb2) → stable short string. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * A signature that changes whenever the rounds that matter to a profile change
 * (added, removed, or their side/result/report edited). Used to flag a stale
 * profile. Order-independent so reordering alone doesn't invalidate it.
 */
export function roundsSignature(rounds: Round[]): string {
  const parts = rounds
    .map((r) => `${r.id}:${r.side}:${r.result}:${r.report.trim()}`)
    .sort();
  return `${rounds.length}|${djb2(parts.join("~"))}`;
}

/** Compact one-line-ish summary of a profile for the Coach's system prompt. */
export function profileToContext(profile: DebaterProfile): string {
  const parts = [`Skill tier: ${profile.skillTier}.`, profile.summary.trim()];
  if (profile.weaknesses.length) parts.push(`Recurring weaknesses: ${profile.weaknesses.join("; ")}.`);
  if (profile.strengths.length) parts.push(`Strengths: ${profile.strengths.join("; ")}.`);
  if (profile.focusAreas.length) parts.push(`Focus next: ${profile.focusAreas.join("; ")}.`);
  return parts.join(" ").slice(0, 1500);
}

// ---- external store surface ----------------------------------------------

let cache: StoredProfile | null | undefined; // undefined = not loaded yet
const listeners = new Set<() => void>();

function load(): StoredProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProfile;
    return parsed && parsed.profile ? parsed : null;
  } catch {
    return null;
  }
}

export function subscribeProfile(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getProfileSnapshot(): StoredProfile | null {
  if (cache === undefined) cache = load();
  return cache;
}

export function getProfileServerSnapshot(): StoredProfile | null {
  return null;
}

export function storeProfile(profile: DebaterProfile, signature: string): void {
  const stored: StoredProfile = { profile, signature, generatedAt: new Date().toISOString() };
  cache = stored;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(stored));
    } catch {
      /* storage disabled — profile just won't persist */
    }
  }
  listeners.forEach((l) => l());
}

export function clearProfile(): void {
  cache = null;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}
