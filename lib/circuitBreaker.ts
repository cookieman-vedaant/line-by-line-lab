/**
 * A circuit breaker for outbound dependencies (Gemini, article fetches).
 *
 * The problem it solves: when a provider is genuinely down, retry-with-backoff
 * makes things WORSE. Every request spends its full retry ladder before failing,
 * so users wait ~30s to be told no, serverless functions stay alive burning
 * execution time, and the provider gets hammered while it's trying to recover.
 *
 * The breaker notices a run of failures and "opens" — subsequent calls fail
 * INSTANTLY without touching the network. After a cooldown it goes "half-open"
 * and lets a single probe through: success closes it, failure re-opens it.
 *
 * Deliberately in-memory and per-instance. A shared breaker in Redis would add a
 * round trip to every AI call to save a fraction of a second on the rare failure
 * path — the wrong trade. Each serverless instance learning independently is
 * good enough, and it degrades safely: worst case a few instances each waste one
 * probe.
 */

export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerOptions {
  /** Consecutive failures before the circuit opens. */
  threshold?: number;
  /** How long to stay open before allowing a probe, in ms. */
  cooldownMs?: number;
}

export interface Breaker {
  /** True if a call should be attempted. False means fail fast. */
  canAttempt(now?: number): boolean;
  recordSuccess(): void;
  recordFailure(now?: number): void;
  state(now?: number): BreakerState;
}

/** Thrown instead of calling a dependency that is currently failing. */
export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`${name} is temporarily unavailable. Please try again in a moment.`);
    this.name = "CircuitOpenError";
  }
}

/**
 * Deterministic factory — `now` is injectable so the behavior is unit-testable
 * without timers.
 */
export function createBreaker(opts: BreakerOptions = {}): Breaker {
  // 5 is high enough that ordinary one-off blips (which the retry logic already
  // absorbs) never trip it; only a sustained outage does.
  const threshold = opts.threshold ?? 5;
  const cooldownMs = opts.cooldownMs ?? 30_000;

  let failures = 0;
  let openedAt = 0;
  // Set while a half-open probe is in flight, so a burst of concurrent requests
  // sends exactly ONE probe rather than all of them at a struggling provider.
  let probing = false;

  function state(now: number = Date.now()): BreakerState {
    if (failures < threshold) return "closed";
    if (now - openedAt >= cooldownMs) return "half-open";
    return "open";
  }

  return {
    state,
    canAttempt(now: number = Date.now()): boolean {
      const s = state(now);
      if (s === "closed") return true;
      if (s === "open") return false;
      if (probing) return false; // another request is already probing
      probing = true;
      return true;
    },
    recordSuccess() {
      failures = 0;
      probing = false;
    },
    recordFailure(now: number = Date.now()) {
      failures += 1;
      probing = false;
      // Restart the cooldown whenever we cross (or re-cross) the threshold, so a
      // failed probe buys another full cooldown instead of retrying immediately.
      if (failures >= threshold) openedAt = now;
    },
  };
}

/** App-wide breakers, one per dependency so a bad article host can't open the AI circuit. */
const breakers = new Map<string, Breaker>();

export function getBreaker(name: string, opts?: BreakerOptions): Breaker {
  let b = breakers.get(name);
  if (!b) {
    b = createBreaker(opts);
    breakers.set(name, b);
  }
  return b;
}

/**
 * Run `fn` under the named breaker. Throws CircuitOpenError immediately when the
 * circuit is open.
 *
 * `isFailure` decides what counts against the breaker. This matters: a 400 from
 * a bad prompt is OUR bug and says nothing about the provider's health, so
 * counting it would open the circuit for everyone over one malformed request.
 * Only treat infrastructure failures as failures.
 */
export async function withBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  isFailure: (err: unknown) => boolean = () => true,
  opts?: BreakerOptions,
): Promise<T> {
  const breaker = getBreaker(name, opts);
  if (!breaker.canAttempt()) throw new CircuitOpenError(name);
  try {
    const result = await fn();
    breaker.recordSuccess();
    return result;
  } catch (err) {
    if (isFailure(err)) breaker.recordFailure();
    else breaker.recordSuccess(); // a caller-side error proves the dependency is reachable
    throw err;
  }
}
