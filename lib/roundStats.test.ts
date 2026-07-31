import { describe, expect, it } from "vitest";
import { formatRecord, summarizeRounds } from "@/lib/roundStats";
import type { Round } from "@/types";

function round(side: "Aff" | "Neg", result: "W" | "L"): Round {
  return {
    id: crypto.randomUUID(),
    tournament: "T",
    roundLabel: "R1",
    side,
    result,
    report: "",
    createdAt: new Date().toISOString(),
  };
}

describe("summarizeRounds", () => {
  it("returns all-zero with a 0 win rate for no rounds", () => {
    const s = summarizeRounds([]);
    expect(s).toEqual({
      total: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      aff: { wins: 0, losses: 0 },
      neg: { wins: 0, losses: 0 },
    });
  });

  it("counts wins, losses, and win rate", () => {
    const s = summarizeRounds([
      round("Aff", "W"),
      round("Neg", "W"),
      round("Aff", "L"),
      round("Neg", "W"),
    ]);
    expect(s.total).toBe(4);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBe(0.75);
  });

  it("splits the record by side", () => {
    const s = summarizeRounds([
      round("Aff", "W"),
      round("Aff", "W"),
      round("Aff", "L"),
      round("Neg", "L"),
    ]);
    expect(s.aff).toEqual({ wins: 2, losses: 1 });
    expect(s.neg).toEqual({ wins: 0, losses: 1 });
  });
});

describe("formatRecord", () => {
  it("renders a wins–losses string", () => {
    expect(formatRecord(7, 3)).toBe("7–3");
  });
});
