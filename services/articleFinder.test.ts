import { describe, expect, it } from "vitest";
import { heuristicQueries } from "./articleFinder";

describe("heuristicQueries", () => {
  it("always returns the raw claim as the first query", () => {
    expect(heuristicQueries("nuclear power reduces carbon emissions")[0]).toBe(
      "nuclear power reduces carbon emissions",
    );
  });

  it("adds a jargon-stripped variant when it meaningfully differs", () => {
    const qs = heuristicQueries("the aff plan solves warming through solvency");
    expect(qs).toHaveLength(2);
    expect(qs[1]).not.toMatch(/\b(aff|plan|solvency)\b/i);
  });

  it("returns a single query when there's no debate jargon to strip", () => {
    expect(heuristicQueries("economic sanctions cause humanitarian harm")).toHaveLength(1);
  });
});
