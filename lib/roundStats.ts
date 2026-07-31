import type { Round, RoundSummary } from "@/types";

/**
 * Pure record math for the Round Log: turn a list of logged rounds into a
 * win/loss summary with Aff/Neg splits. No DOM, no storage — unit-tested.
 */
export function summarizeRounds(rounds: Round[]): RoundSummary {
  const summary: RoundSummary = {
    total: rounds.length,
    wins: 0,
    losses: 0,
    winRate: 0,
    aff: { wins: 0, losses: 0 },
    neg: { wins: 0, losses: 0 },
  };

  for (const round of rounds) {
    const won = round.result === "W";
    if (won) summary.wins += 1;
    else summary.losses += 1;

    const bucket = round.side === "Aff" ? summary.aff : summary.neg;
    if (won) bucket.wins += 1;
    else bucket.losses += 1;
  }

  summary.winRate = summary.total > 0 ? summary.wins / summary.total : 0;
  return summary;
}

/** Format a wins–losses pair as a record string, e.g. "7–3". */
export function formatRecord(wins: number, losses: number): string {
  return `${wins}–${losses}`;
}
