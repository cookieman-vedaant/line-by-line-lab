import { describe, expect, it } from "vitest";
import { MIN_PASSWORD, PASSWORD_HINT, passwordProblem } from "./passwordPolicy";

describe("password policy", () => {
  // Supabase's own `password_min_length` is 8. If this drops below that, forms
  // start accepting passwords the server will reject — which is exactly the bug
  // that stranded people on the reset-password screen.
  it("is at least as strict as the Supabase server setting", () => {
    expect(MIN_PASSWORD).toBeGreaterThanOrEqual(8);
  });

  it("rejects anything shorter than the minimum", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD - 1))).toMatch(/at least 8 characters/);
    expect(passwordProblem("")).not.toBeNull();
  });

  it("accepts a password at exactly the minimum", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD))).toBeNull();
  });

  it("only compares the confirmation when one was supplied", () => {
    const pw = "correct-horse";
    expect(passwordProblem(pw)).toBeNull();
    expect(passwordProblem(pw, pw)).toBeNull();
    expect(passwordProblem(pw, "battery-staple")).toMatch(/don't match/);
  });

  it("checks length before the confirmation, so the useful error wins", () => {
    expect(passwordProblem("short", "different")).toMatch(/at least 8 characters/);
  });

  it("states the real number in the hint", () => {
    expect(PASSWORD_HINT).toContain(String(MIN_PASSWORD));
  });
});
