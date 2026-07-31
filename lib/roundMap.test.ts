import { describe, expect, it } from "vitest";
import { rowToRound, type RoundRow } from "./roundMap";

const base: RoundRow = {
  id: "abc",
  tournament: "Berkeley",
  round_label: "R3",
  side: "Neg",
  result: "L",
  opponent: "Lincoln HS — AB",
  report: "Lost on framework.",
  created_at: "2026-07-31T00:00:00.000Z",
};

describe("rowToRound", () => {
  it("maps snake_case DB columns to the camelCase Round shape", () => {
    expect(rowToRound(base)).toEqual({
      id: "abc",
      tournament: "Berkeley",
      roundLabel: "R3",
      side: "Neg",
      result: "L",
      opponent: "Lincoln HS — AB",
      report: "Lost on framework.",
      createdAt: "2026-07-31T00:00:00.000Z",
    });
  });

  it("defaults unknown side/result to Aff/W and drops a null opponent", () => {
    const row: RoundRow = {
      ...base,
      side: "weird",
      result: null,
      opponent: null,
      report: null,
      tournament: null,
      round_label: null,
    };
    const round = rowToRound(row);
    expect(round.side).toBe("Aff");
    expect(round.result).toBe("W");
    expect(round.opponent).toBeUndefined();
    expect(round.report).toBe("");
    expect(round.tournament).toBe("");
    expect(round.roundLabel).toBe("");
  });

  it("keeps Aff/W as-is", () => {
    expect(rowToRound({ ...base, side: "Aff", result: "W" }).side).toBe("Aff");
    expect(rowToRound({ ...base, side: "Aff", result: "W" }).result).toBe("W");
  });
});
