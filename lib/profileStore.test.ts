import { describe, expect, it } from "vitest";
import { profileToContext, roundsSignature } from "@/lib/profileStore";
import type { DebaterProfile, Round } from "@/types";

function round(partial: Partial<Round> = {}): Round {
  return {
    id: partial.id ?? crypto.randomUUID(),
    tournament: "T",
    roundLabel: "R1",
    side: partial.side ?? "Aff",
    result: partial.result ?? "W",
    report: partial.report ?? "note",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("roundsSignature", () => {
  it("is stable across reordering (order-independent)", () => {
    const a = round({ id: "1" });
    const b = round({ id: "2" });
    expect(roundsSignature([a, b])).toBe(roundsSignature([b, a]));
  });

  it("changes when a report is edited", () => {
    const before = [round({ id: "1", report: "lost on framework" })];
    const after = [round({ id: "1", report: "lost on theory" })];
    expect(roundsSignature(before)).not.toBe(roundsSignature(after));
  });

  it("changes when a round is added", () => {
    const one = [round({ id: "1" })];
    const two = [round({ id: "1" }), round({ id: "2" })];
    expect(roundsSignature(one)).not.toBe(roundsSignature(two));
  });
});

describe("profileToContext", () => {
  const profile: DebaterProfile = {
    skillTier: "Varsity",
    summary: "Strong on impacts, shaky on framework.",
    strengths: ["impact calculus"],
    weaknesses: ["answering framework", "perm theory"],
    focusAreas: ["drill NC framework"],
  };

  it("includes tier, weaknesses, strengths, and focus", () => {
    const ctx = profileToContext(profile);
    expect(ctx).toContain("Varsity");
    expect(ctx).toContain("answering framework");
    expect(ctx).toContain("impact calculus");
    expect(ctx).toContain("drill NC framework");
  });

  it("is bounded in length", () => {
    expect(profileToContext(profile).length).toBeLessThanOrEqual(1500);
  });
});
