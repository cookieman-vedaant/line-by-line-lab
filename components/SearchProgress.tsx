"use client";

import { SEARCH_STAGES, type SearchStage } from "@/types";

/**
 * What each phase of `runSearch` is actually doing, in the debater's terms.
 * These describe real work — if a stage is showing, the server is in it. Keep
 * them honest: don't add a step here that the pipeline doesn't emit.
 */
const STAGE_LABELS: Record<SearchStage, string> = {
  retrieve: "Searching scholarly databases + web",
  rank: "Ranking for debate usefulness",
  verify: "Checking each source opens",
};

/**
 * Live progress for a running search.
 *
 * `stage` is null until the server reports its first phase — which for a cached
 * search never happens, because the result comes back before there is anything
 * to narrate.
 */
export default function SearchProgress({ stage }: { stage: SearchStage | null }) {
  const active = stage ? SEARCH_STAGES.indexOf(stage) : -1;

  return (
    <div className="frame bg-paper-2 px-4 py-4 sm:px-5">
      {/*
        One short message per step. The visual list is aria-hidden so a screen
        reader hears "Ranking for debate usefulness" as it happens, rather than
        re-reading all three rows on every change.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {stage ? STAGE_LABELS[stage] : "Starting search"}
      </p>

      <ol aria-hidden className="flex flex-col gap-3">
        {SEARCH_STAGES.map((s, index) => {
          const done = index < active;
          const current = index === active;

          return (
            <li key={s} className="flex items-center gap-3">
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rotate-45 border-2 transition-colors ${
                  done
                    ? "border-ink bg-ink"
                    : current
                      ? "border-accent bg-accent"
                      : "border-ink/25 bg-transparent"
                }`}
              />
              <span
                className={`label-mono shrink-0 text-[10px] leading-tight transition-colors sm:text-[11px] ${
                  done ? "text-ink/55" : current ? "text-accent" : "text-ink/30"
                }`}
              >
                {STAGE_LABELS[s]}
              </span>
              {/* The rule doubles as the progress track: it sweeps while the
                  step runs and goes solid once it's behind us. */}
              <span
                className={`h-[3px] min-w-4 flex-1 ${
                  current ? "stage-sweep" : done ? "bg-ink/25" : "bg-ink/10"
                }`}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
