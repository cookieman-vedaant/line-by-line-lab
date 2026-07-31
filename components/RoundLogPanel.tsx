"use client";

import { useState, useSyncExternalStore } from "react";
import { requestProfile } from "@/lib/apiClient";
import {
  getProfileServerSnapshot,
  getProfileSnapshot,
  roundsSignature,
  storeProfile,
  subscribeProfile,
} from "@/lib/profileStore";
import {
  addRound,
  deleteRound,
  getRoundsServerSnapshot,
  getRoundsSnapshot,
  subscribeRounds,
} from "@/lib/roundLog";
import { formatRecord, summarizeRounds } from "@/lib/roundStats";
import { ROUND_RESULTS, ROUND_SIDES, type RoundResult, type RoundSide } from "@/types";

const inputClasses =
  "w-full frame bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink " +
  "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";
const labelClasses = "label-mono mb-2 block text-xs text-ink";

/** A labeled bullet list for a profile section; renders nothing when empty. */
function profileList(label: string, items: string[]) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="label-mono text-[10px] text-accent">{label}</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={item} className="text-sm font-medium leading-snug text-ink/85">
            • {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Round Log ("Record" tab): a debater logs their own tournament rounds
 * (W/L + a short "why"). Data is local-first (lib/roundLog). Phase 1 = capture +
 * a record summary; later phases turn the reports into personalized coaching.
 */
export default function RoundLogPanel() {
  const rounds = useSyncExternalStore(subscribeRounds, getRoundsSnapshot, getRoundsServerSnapshot);
  const stored = useSyncExternalStore(subscribeProfile, getProfileSnapshot, getProfileServerSnapshot);
  const [tournament, setTournament] = useState("");
  const [roundLabel, setRoundLabel] = useState("");
  const [side, setSide] = useState<RoundSide>("Aff");
  const [result, setResult] = useState<RoundResult>("W");
  const [opponent, setOpponent] = useState("");
  const [report, setReport] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const stale = stored !== null && stored.signature !== roundsSignature(rounds);

  async function analyze() {
    if (rounds.length === 0 || profileBusy) return;
    setProfileBusy(true);
    setProfileError(null);
    const outcome = await requestProfile(rounds);
    setProfileBusy(false);
    if (!outcome.ok) {
      setProfileError(outcome.error);
      return;
    }
    storeProfile(outcome.profile, roundsSignature(rounds));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tournament.trim() || !roundLabel.trim()) {
      setError("Add at least the tournament and the round (e.g. “Berkeley”, “R3”).");
      return;
    }
    setError(null);
    addRound({
      tournament: tournament.trim(),
      roundLabel: roundLabel.trim(),
      side,
      result,
      opponent: opponent.trim() || undefined,
      report: report.trim(),
    });
    // Keep tournament (usually the same across a session); clear the rest.
    setRoundLabel("");
    setOpponent("");
    setReport("");
    setResult("W");
  }

  const summary = summarizeRounds(rounds);
  const winPct = Math.round(summary.winRate * 100);

  const toggle = <T extends string>(
    value: T,
    current: T,
    set: (v: T) => void,
    label: string,
  ) => (
    <button
      key={value}
      type="button"
      onClick={() => set(value)}
      aria-pressed={current === value}
      className={`btn-press frame px-4 py-1.5 font-display text-xs font-bold uppercase tracking-wide ${
        current === value ? "bg-accent text-paper" : "bg-paper-2 text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-8">
      {/* Record summary */}
      <section className="frame shadow-hard bg-paper-2 p-5">
        <p className="label-mono text-[10px] text-ink/60">Your record</p>
        {summary.total === 0 ? (
          <p className="mt-2 text-sm font-medium text-ink/70">
            No rounds yet. Log one below — your record and (soon) tailored coaching build from these.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="font-display text-4xl font-extrabold leading-none">
                {formatRecord(summary.wins, summary.losses)}
              </p>
              <p className="label-mono mt-1 text-[10px] text-ink/60">
                {summary.total} round{summary.total === 1 ? "" : "s"} · {winPct}% win rate
              </p>
            </div>
            <div className="flex gap-6">
              <div>
                <p className="label-mono text-[10px] text-accent">Aff</p>
                <p className="font-display text-lg font-bold">{formatRecord(summary.aff.wins, summary.aff.losses)}</p>
              </div>
              <div>
                <p className="label-mono text-[10px] text-accent">Neg</p>
                <p className="font-display text-lg font-bold">{formatRecord(summary.neg.wins, summary.neg.losses)}</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* AI profile — the debater's own read, cached locally (per device) */}
      <section className="frame bg-paper-2 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="label-mono text-[10px] text-ink/60">
            Your profile <span className="text-ink/40">· AI read on your game</span>
          </p>
          {stored && (
            <button
              type="button"
              onClick={analyze}
              disabled={profileBusy}
              className="btn-press frame bg-paper px-3 py-1 text-[10px] font-bold text-ink hover:text-accent disabled:opacity-60"
            >
              {profileBusy ? "…" : "Re-analyze"}
            </button>
          )}
        </div>

        {!stored ? (
          <div className="mt-2">
            <p className="text-sm font-medium leading-snug text-ink/70">
              {rounds.length === 0
                ? "Log a few rounds with notes, then get an AI read on your skill level and recurring weaknesses — it tailors the Coach to you."
                : "Get an AI read on your skill level and recurring weaknesses. It personalizes the Coach to your game."}
            </p>
            <button
              type="button"
              onClick={analyze}
              disabled={rounds.length === 0 || profileBusy}
              className="btn-press frame mt-3 bg-accent px-4 py-2 font-display text-xs font-bold
                uppercase tracking-wide text-paper disabled:opacity-60"
            >
              {profileBusy ? "Analyzing…" : "✦ Analyze my rounds"}
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="label-mono frame bg-accent px-2 py-0.5 text-[10px] font-bold text-paper">
                {stored.profile.skillTier}
              </span>
              {stale && (
                <span className="label-mono text-[10px] font-bold text-red">
                  rounds changed — re-analyze
                </span>
              )}
            </div>
            <p className="text-sm font-medium leading-snug">{stored.profile.summary}</p>
            {profileList("Strengths", stored.profile.strengths)}
            {profileList("Work on", stored.profile.weaknesses)}
            {profileList("Focus next", stored.profile.focusAreas)}
          </div>
        )}

        {profileBusy && (
          <p className="label-mono mt-3 animate-pulse text-xs text-accent">▸ reading your rounds…</p>
        )}
        {profileError && (
          <p role="alert" className="mt-3 text-[11px] font-semibold text-red">
            {profileError}
          </p>
        )}
      </section>

      {/* Log a round */}
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="round-tournament" className={labelClasses}>
              Tournament <span className="text-red">*</span>
            </label>
            <input
              id="round-tournament"
              value={tournament}
              onChange={(e) => setTournament(e.target.value)}
              placeholder="e.g. Berkeley"
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="round-label" className={labelClasses}>
              Round <span className="text-red">*</span>
            </label>
            <input
              id="round-label"
              value={roundLabel}
              onChange={(e) => setRoundLabel(e.target.value)}
              placeholder="e.g. R3, Quarters"
              className={inputClasses}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <div>
            <span className={labelClasses}>Side</span>
            <div className="flex gap-2">{ROUND_SIDES.map((s) => toggle(s, side, setSide, s))}</div>
          </div>
          <div>
            <span className={labelClasses}>Result</span>
            <div className="flex gap-2">
              {ROUND_RESULTS.map((r) => toggle(r, result, setResult, r === "W" ? "Win" : "Loss"))}
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="round-opponent" className={labelClasses}>
            Opponent <span className="text-ink/40">(optional, stays on your device)</span>
          </label>
          <input
            id="round-opponent"
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder="e.g. Lincoln HS — AB"
            className={inputClasses}
          />
        </div>

        <div>
          <label htmlFor="round-report" className={labelClasses}>
            Round report <span className="text-ink/40">(why it went the way it did — powers your coaching)</span>
          </label>
          <textarea
            id="round-report"
            value={report}
            onChange={(e) => setReport(e.target.value)}
            rows={4}
            placeholder="e.g. Lost on framework — judge said I never answered their standard. Dropped the perm in the 1AR."
            className={`${inputClasses} resize-y`}
          />
        </div>

        {error && (
          <p role="alert" className="frame bg-red px-4 py-3 text-sm font-semibold text-white">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="btn-press frame mt-1 w-full bg-accent px-6 py-3.5 font-display
            text-base font-bold uppercase tracking-wide text-paper sm:w-auto sm:self-start"
        >
          + Log Round
        </button>
      </form>

      {/* Logged rounds */}
      {rounds.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="label-mono text-xs text-ink/60">Logged rounds</p>
          <ul className="flex flex-col gap-3">
            {rounds.map((r) => (
              <li key={r.id} className="frame bg-paper-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-sm font-bold">
                      {r.tournament} · {r.roundLabel}
                    </p>
                    <p className="label-mono mt-1 text-[10px] text-ink/60">
                      {r.side}
                      {r.opponent ? ` · vs ${r.opponent}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`label-mono frame px-2 py-0.5 text-[10px] font-bold ${
                        r.result === "W" ? "bg-accent text-paper" : "bg-red text-white"
                      }`}
                    >
                      {r.result === "W" ? "WIN" : "LOSS"}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteRound(r.id)}
                      aria-label={`Delete ${r.tournament} ${r.roundLabel}`}
                      className="btn-press frame bg-paper px-2 py-0.5 text-[10px] font-bold text-ink hover:text-red"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {r.report && (
                  <p className="mt-2 text-sm font-medium leading-snug text-ink/80">{r.report}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
