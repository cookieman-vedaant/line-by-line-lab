/**
 * Which Gemini models are usable RIGHT NOW, as opposed to which ones we'd
 * PREFER (that's lib/models.ts).
 *
 * The distinction exists because Google's free tier caps some models per DAY,
 * per project — `gemini-3.5-flash` is capped at 20 requests/day, which one
 * eight-section card cut exhausts in a single click. A day-long condition is
 * categorically different from the blips the retry ladder and the circuit
 * breaker were built for:
 *
 *   - Retrying is pointless. It resets tomorrow, not in 3 seconds.
 *   - It says NOTHING about Gemini's health, so it must not open a circuit.
 *   - It is PER MODEL. The cheap model can be perfectly healthy while the
 *     premium one is finished for the day.
 *
 * So an exhausted model is parked here and skipped outright, letting callers
 * fail over to a working model instantly instead of paying for a doomed call.
 *
 * ── WHY IT RE-PROBES INSTEAD OF WAITING FOR MIDNIGHT ────────────────────────
 * The obvious design is to park the model until the quota window resets. This
 * one re-probes every few minutes instead, which costs a single rejected
 * request (~100ms, and a denied request consumes no quota) and buys something
 * worth much more: when the account's billing is enabled, the cap disappears
 * and the very next probe SUCCEEDS. The app returns to the premium model on its
 * own, with no redeploy, no env change, and nobody having to remember to flip
 * anything. Hardcoding a midnight reset would have made enabling billing a
 * silent no-op until the next day.
 *
 * Deliberately in-memory and per-instance, matching lib/circuitBreaker: a
 * shared registry in Redis would add a round trip to every AI call to save one
 * cheap probe per instance. Worst case each instance learns independently.
 */

const DEFAULT_PROBE_MINUTES = 10;

/** How long an exhausted model is skipped before one probe is allowed through. */
function probeIntervalMs(): number {
  const n = Number(process.env.GEMINI_MODEL_PROBE_MINUTES);
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_PROBE_MINUTES) * 60_000;
}

/**
 * A probe that never settles (hung socket) must not latch a model out forever,
 * so the claim expires on its own.
 */
const PROBE_TIMEOUT_MS = 60_000;

interface Exhaustion {
  /** Earliest time a probe may be attempted. */
  retryAt: number;
  /** Start time of the in-flight probe, or 0 when none is running. */
  probingSince: number;
}

const exhausted = new Map<string, Exhaustion>();

/**
 * Park `model` — its daily quota is gone. Also re-arms the wait after a failed
 * probe, so a still-capped model backs off again rather than being retried by
 * every request.
 */
export function markModelExhausted(model: string, now: number = Date.now()): void {
  exhausted.set(model, { retryAt: now + probeIntervalMs(), probingSince: 0 });
}

/**
 * Un-park `model`. Called on every success, so the moment a probe gets through
 * — typically because billing was enabled — normal service resumes.
 */
export function markModelAvailable(model: string): void {
  exhausted.delete(model);
}

/**
 * True if a call to `model` should be attempted. False means "skip it, this
 * model is out of quota" — the caller should fail over rather than wait.
 *
 * Exactly ONE caller gets the probe when the wait expires. That matters because
 * a single card cut fans out eight marker calls CONCURRENTLY (Promise.all in
 * services/cardCutter): without the latch all eight would probe a model already
 * known to be dead, which is the stampede this module exists to prevent.
 */
export function claimModelAttempt(model: string, now: number = Date.now()): boolean {
  const entry = exhausted.get(model);
  if (!entry) return true;
  if (now < entry.retryAt) return false;
  // Someone else is already probing — unless their claim went stale.
  if (entry.probingSince !== 0 && now - entry.probingSince < PROBE_TIMEOUT_MS) return false;
  entry.probingSince = now;
  return true;
}

/** Whether `model` is currently parked. Diagnostics and tests. */
export function modelIsExhausted(model: string, now: number = Date.now()): boolean {
  const entry = exhausted.get(model);
  return entry !== undefined && now < entry.retryAt;
}

/** Test seam — the registry is module-level state. */
export function resetModelAvailability(): void {
  exhausted.clear();
}
