import type { DebaterProfile, Round } from "@/types";
import type { SaveResult } from "@/lib/roundLog";

/**
 * Account-backed cache of the AI debater profile. Like the Round Log, this is
 * PERSONAL data, now stored per-user in Supabase (`debater_profile`) via
 * `/api/debater-profile`, so the AI's read on the debater follows them across
 * devices. We also keep a signature of the rounds the profile was built from, so
 * the UI can tell the debater when their profile is out of date.
 *
 * Exposed as an external store (subscribe + snapshot) for useSyncExternalStore;
 * the data loads asynchronously via `loadProfile()`.
 */

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

let cache: StoredProfile | null = null;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function subscribeProfile(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getProfileSnapshot(): StoredProfile | null {
  return cache;
}

export function getProfileServerSnapshot(): StoredProfile | null {
  return null;
}

export function getProfileLoadedSnapshot(): boolean {
  return loaded;
}
export function getProfileLoadedServerSnapshot(): boolean {
  return false;
}

/** Fetch the signed-in user's saved profile. Idempotent (runs once). */
export async function loadProfile(force = false): Promise<void> {
  if (loading) return loading;
  if (loaded && !force) return;
  loading = (async () => {
    try {
      const res = await fetch("/api/debater-profile", { headers: { Accept: "application/json" } });
      if (res.ok) {
        const data = (await res.json()) as { stored?: StoredProfile | null };
        cache = data.stored ?? null;
      }
    } catch {
      /* offline — keep whatever we have */
    } finally {
      loaded = true;
      loading = null;
      notify();
    }
  })();
  return loading;
}

/** Save (upsert) the profile to the account, then update the cache. */
export async function storeProfile(profile: DebaterProfile, signature: string): Promise<SaveResult> {
  try {
    const res = await fetch("/api/debater-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, signature }),
    });
    const data = (await res.json().catch(() => ({}))) as { stored?: StoredProfile; error?: string };
    if (!res.ok || !data.stored) {
      return { ok: false, error: data.error ?? "Couldn't save your profile. Please try again." };
    }
    cache = data.stored;
    notify();
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the server. Is it running?" };
  }
}

export async function clearProfile(): Promise<void> {
  cache = null;
  notify();
  try {
    await fetch("/api/debater-profile", { method: "DELETE" });
  } catch {
    /* best effort */
  }
}
