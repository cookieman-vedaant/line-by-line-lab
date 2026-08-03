import { describe, expect, it } from "vitest";
import { CircuitOpenError, createBreaker, withBreaker } from "@/lib/circuitBreaker";

/** `now` is injected throughout so none of this depends on real timers. */

describe("createBreaker", () => {
  it("starts closed and allows calls", () => {
    const b = createBreaker();
    expect(b.state(0)).toBe("closed");
    expect(b.canAttempt(0)).toBe(true);
  });

  it("stays closed while failures are below the threshold", () => {
    const b = createBreaker({ threshold: 3 });
    b.recordFailure(0);
    b.recordFailure(0);
    expect(b.state(0)).toBe("closed");
    expect(b.canAttempt(0)).toBe(true);
  });

  it("opens once failures reach the threshold, and then fails fast", () => {
    const b = createBreaker({ threshold: 3, cooldownMs: 1000 });
    for (let i = 0; i < 3; i++) b.recordFailure(0);
    expect(b.state(0)).toBe("open");
    expect(b.canAttempt(0)).toBe(false);
  });

  it("resets on success, so intermittent failures never accumulate into an outage", () => {
    const b = createBreaker({ threshold: 3 });
    b.recordFailure(0);
    b.recordFailure(0);
    b.recordSuccess();
    b.recordFailure(0);
    expect(b.state(0)).toBe("closed");
  });

  it("goes half-open after the cooldown", () => {
    const b = createBreaker({ threshold: 2, cooldownMs: 1000 });
    b.recordFailure(0);
    b.recordFailure(0);
    expect(b.state(500)).toBe("open");
    expect(b.state(1000)).toBe("half-open");
  });

  it("lets exactly ONE probe through while half-open", () => {
    // A burst of concurrent requests must not all stampede a recovering provider.
    const b = createBreaker({ threshold: 2, cooldownMs: 1000 });
    b.recordFailure(0);
    b.recordFailure(0);
    expect(b.canAttempt(1000)).toBe(true);
    expect(b.canAttempt(1000)).toBe(false);
    expect(b.canAttempt(1000)).toBe(false);
  });

  it("closes when the probe succeeds", () => {
    const b = createBreaker({ threshold: 2, cooldownMs: 1000 });
    b.recordFailure(0);
    b.recordFailure(0);
    b.canAttempt(1000);
    b.recordSuccess();
    expect(b.state(1000)).toBe("closed");
  });

  it("re-opens for another full cooldown when the probe fails", () => {
    const b = createBreaker({ threshold: 2, cooldownMs: 1000 });
    b.recordFailure(0);
    b.recordFailure(0);
    b.canAttempt(1000);
    b.recordFailure(1000);
    // Not immediately probeable again — otherwise a dead provider gets hammered.
    expect(b.state(1500)).toBe("open");
    expect(b.state(2000)).toBe("half-open");
  });
});

describe("withBreaker", () => {
  it("returns the result and keeps the circuit closed on success", async () => {
    const out = await withBreaker("t-ok", async () => 42);
    expect(out).toBe(42);
  });

  it("throws CircuitOpenError once the dependency has failed enough", async () => {
    const boom = async () => {
      throw new Error("503 UNAVAILABLE");
    };
    for (let i = 0; i < 3; i++) {
      await expect(withBreaker("t-open", boom, () => true, { threshold: 3 })).rejects.toThrow();
    }
    await expect(withBreaker("t-open", boom, () => true, { threshold: 3 })).rejects.toThrow(
      CircuitOpenError,
    );
  });

  it("does not open the circuit for caller-side errors", async () => {
    // A 400 from a malformed prompt is our bug and proves the provider is
    // reachable. Counting it would take the AI offline for everyone.
    const badRequest = async () => {
      throw new Error("400 INVALID_ARGUMENT");
    };
    const isInfra = (e: unknown) => e instanceof Error && /503|UNAVAILABLE/.test(e.message);
    for (let i = 0; i < 6; i++) {
      await expect(
        withBreaker("t-caller", badRequest, isInfra, { threshold: 3 }),
      ).rejects.toThrow(/400/);
    }
    // Still closed: the next call reaches the dependency rather than failing fast.
    await expect(withBreaker("t-caller", async () => "ok", isInfra, { threshold: 3 })).resolves.toBe(
      "ok",
    );
  });

  it("keeps separate dependencies isolated", async () => {
    const boom = async () => {
      throw new Error("503");
    };
    for (let i = 0; i < 4; i++) {
      await expect(withBreaker("t-dep-a", boom, () => true, { threshold: 3 })).rejects.toThrow();
    }
    // A failing article host must not take the AI circuit down with it.
    await expect(withBreaker("t-dep-b", async () => "fine")).resolves.toBe("fine");
  });
});
