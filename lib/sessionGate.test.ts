import { describe, expect, it } from "vitest";
import { gateDecision, isProtectedPath } from "./sessionGate";

describe("isProtectedPath", () => {
  it("covers the Lab and everything under it", () => {
    expect(isProtectedPath("/lab")).toBe(true);
    expect(isProtectedPath("/lab/admin")).toBe(true);
    expect(isProtectedPath("/lab/admin/costs")).toBe(true);
  });

  it("leaves public routes alone", () => {
    for (const path of ["/", "/docs", "/privacy", "/auth/confirm", "/reset-password"]) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  it("does not gate a route that merely starts with the same letters", () => {
    expect(isProtectedPath("/labs")).toBe(false);
    expect(isProtectedPath("/laboratory")).toBe(false);
  });
});

describe("gateDecision", () => {
  it("serves public routes whatever the session state", () => {
    for (const state of ["signed-in", "signed-out", "unknown"] as const) {
      expect(gateDecision(false, state)).toBe("allow");
    }
  });

  it("serves a protected route to a confirmed user", () => {
    expect(gateDecision(true, "signed-in")).toBe("allow");
  });

  it("fails closed on a protected route when the user is confirmed signed out", () => {
    expect(gateDecision(true, "signed-out")).toBe("redirect-to-signin");
  });

  // The regression this whole split exists for: a revalidation that timed out or
  // failed in transport is NOT evidence of being logged out, and treating it as
  // such threw signed-in users out of the Lab whenever auth was briefly slow.
  it("does not evict a user when revalidation could not be completed", () => {
    expect(gateDecision(true, "unknown")).toBe("allow");
  });
});
