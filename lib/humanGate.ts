/**
 * Client-side state for the human gate. The SECURITY token is the HttpOnly
 * cookie the server sets (unreadable here); this store just remembers, per
 * device, that the visitor already passed the check so we don't re-show the
 * widget on every navigation. Exposed for useSyncExternalStore.
 *
 * The gate is only active when a Turnstile SITE key is configured; otherwise
 * `verified` is always true and the widget never renders.
 */

const KEY = "lbl-human-until";
const listeners = new Set<() => void>();

/** Public Turnstile site key (inlined at build time), or undefined when unset. */
export function turnstileSiteKey(): string | undefined {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined;
}

export function gateEnabled(): boolean {
  return Boolean(turnstileSiteKey());
}

function verifiedUntil(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

export function subscribeHuman(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Verified if the gate is off, or a non-expired local pass exists. */
export function getHumanSnapshot(): boolean {
  if (!gateEnabled()) return true;
  return verifiedUntil() > Date.now();
}

/** On the server: verified only when the gate is off (else show the gate). */
export function getHumanServerSnapshot(): boolean {
  return !gateEnabled();
}

/** Record a successful check for `ttlMs` and notify subscribers. */
export function markHumanVerified(ttlMs: number): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, String(Date.now() + ttlMs));
    } catch {
      /* storage disabled — the widget will just reappear next load */
    }
  }
  listeners.forEach((l) => l());
}
