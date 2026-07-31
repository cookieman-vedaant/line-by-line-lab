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

/**
 * Compact text summary of the debater's rounds for the Coach's context: the
 * overall record plus the most recent rounds with their reports. Bounded so it
 * never bloats the prompt. Returns "" when there are no rounds. Assumes `rounds`
 * is newest-first (as stored).
 */
export function roundLogToContext(rounds: Round[], maxRounds = 20, maxChars = 4000): string {
  if (rounds.length === 0) return "";
  const s = summarizeRounds(rounds);
  const header = `Record: ${formatRecord(s.wins, s.losses)} (Aff ${formatRecord(
    s.aff.wins,
    s.aff.losses,
  )}, Neg ${formatRecord(s.neg.wins, s.neg.losses)}) across ${s.total} round${
    s.total === 1 ? "" : "s"
  }.`;
  const recent = rounds.slice(0, maxRounds).map((r, i) => {
    const opp = r.opponent ? ` vs ${r.opponent}` : "";
    const rep = r.report.trim() ? `: ${r.report.trim()}` : "";
    return `${i + 1}. ${r.tournament} ${r.roundLabel} — ${r.side}, ${
      r.result === "W" ? "Win" : "Loss"
    }${opp}${rep}`;
  });
  return `${header}\nRecent rounds:\n${recent.join("\n")}`.slice(0, maxChars);
}
