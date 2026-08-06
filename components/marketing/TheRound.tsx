import Reveal from "@/components/marketing/Reveal";
import { TOOLS } from "@/lib/siteContent";

/**
 * The Round — the six stages of prep, scrubbed by scroll position. On a desktop
 * viewport that supports scroll-driven animations the stage pins, each stage
 * cross-fades as you scroll through it, and a playhead rides the rail; everywhere
 * else the same five panels read as a plain vertical list. All of the motion
 * lives in globals.css (`.round-*`), driven by a view timeline rather than a
 * scroll listener, and animates only transform and opacity.
 *
 * Each stage owns a hue (`--stage` / `--stage-fg`, set in globals.css) that runs
 * through its number, its bullets, its handoff ticket, its artifact, and the wash
 * behind it. Every one is mixed from tokens the theme already defines, so a
 * generated theme recolors the sequence along with everything else.
 *
 * The artifacts are deliberately wordless: structure only, no titles, authors, or
 * citations. Every line of prose comes from lib/siteContent, so the claims here
 * are the same ones the Toolkit makes.
 */

/** The workflow loop: the six tools a round actually passes through.
    Theme Studio is the seventh tool but isn't part of the prep loop. */
const STAGES = TOOLS.slice(0, 6);

const RAIL_LABELS = ["Find", "Wiki", "Cut", "Re-Highlight", "Coach", "Record"];

/** What each stage hands to the next. This is the argument for one workspace. */
const HANDOFF = [
  "Send any result straight into the Cutter.",
  "A disclosed cite goes to the Cutter like any other source.",
  "The cut card carries its cite wherever it goes next.",
  "The contradiction report drops into your block.",
  "Blocks and cards come back ready to read.",
  "Your results sharpen the coaching you get next.",
];

/** A wordless stand-in for what the stage produces. Structure, never content. */
function Artifact({ stage }: { stage: number }) {
  // 01 Find — a ranked result list.
  if (stage === 0) {
    return (
      <div className="frame shadow-hard bg-paper p-4">
        {[92, 74, 86, 64].map((w, i) => (
          <div key={i} className="flex items-start gap-3 py-2">
            <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rotate-45 bg-red" />
            <div className="min-w-0 flex-1">
              <div className="h-2 bg-[var(--stage)]" style={{ width: `${w}%` }} />
              <div className="mt-1.5 h-1.5 w-2/5 bg-ink/25" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // 02 Wiki — disclosed files from other schools, each with the matching line lit.
  if (stage === 1) {
    return (
      <div className="frame shadow-hard bg-paper p-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className={i > 0 ? "divide-t mt-3 pt-3" : ""}>
            {/* who disclosed it: school, then team */}
            <div className="flex items-center gap-2">
              <span aria-hidden className="h-2 w-2 shrink-0 rotate-45 bg-[var(--stage)]" />
              <div className="h-1.5 w-1/3 bg-ink/45" />
              <div className="h-1.5 w-1/5 bg-ink/25" />
            </div>
            {/* the matched line inside the file: the hit is the lit run */}
            <div className="mt-2 flex items-center gap-1">
              <div className="h-2 flex-1 bg-ink/20" />
              <div className="h-2 w-2/5 bg-[var(--stage)]" />
              <div className="h-2 w-1/6 bg-ink/20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // 03 Cut and 04 Re-Highlight — the same document, marked two different ways.
  if (stage === 2 || stage === 3) {
    const undercut = stage === 3;
    return (
      <div className="frame shadow-hard bg-paper p-4">
        <div className="h-3 w-4/5 bg-ink" />
        <div className="mt-1.5 h-3 w-3/5 bg-ink" />
        <div className="mt-3 h-2 w-2/5 bg-ink/45" />
        <div className="mt-4 flex flex-col gap-1.5">
          <div className="h-1.5 w-full bg-ink/20" />
          <div className="h-2 w-11/12 bg-ink/70" />
          {/* Their highlight. On Re-Highlight it goes grey and gets struck. */}
          <div className={`relative h-2 w-3/4 ${undercut ? "bg-ink/25" : "bg-[var(--stage)]"}`}>
            {undercut && (
              <span
                aria-hidden
                className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-ink"
              />
            )}
          </div>
          <div className="h-1.5 w-5/6 bg-ink/20" />
          {/* The author's own wording that the card left out. */}
          {undercut ? (
            <div className="mt-1 flex items-center gap-2">
              <span aria-hidden className="h-2 w-2 shrink-0 rotate-45 bg-[var(--stage)]" />
              <div className="h-2 flex-1 bg-[var(--stage)]" />
            </div>
          ) : (
            <div className="h-2 w-2/3 bg-ink/70" />
          )}
        </div>
      </div>
    );
  }

  // 05 Coach — a case going in, a block of cut-card answers coming back.
  if (stage === 4) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="frame w-4/5 bg-paper p-3">
          <div className="h-2 w-full bg-ink/25" />
          <div className="mt-1.5 h-2 w-3/5 bg-ink/25" />
        </div>
        <div className="frame shadow-hard w-3/5 self-end bg-[var(--stage)] p-3">
          <div className="h-2 w-full bg-[var(--stage-fg)] opacity-80" />
          <div className="mt-1.5 h-2 w-2/3 bg-[var(--stage-fg)] opacity-80" />
        </div>
        <div className="frame w-11/12 bg-paper p-3">
          <div className="h-2.5 w-3/4 bg-ink" />
          <div className="mt-2 h-1.5 w-2/5 bg-ink/40" />
          <div className="mt-2 h-2 w-5/6 bg-[var(--stage)]" />
        </div>
      </div>
    );
  }

  // 06 Record — the round log the Coach reads back.
  return (
    <div className="frame shadow-hard bg-paper">
      <div className="divide-b grid grid-cols-4 gap-3 p-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-1.5 bg-ink/35" />
        ))}
      </div>
      {[0, 1, 2, 3].map((r) => (
        <div key={r} className="grid grid-cols-4 items-center gap-3 px-3 py-2.5">
          <div className="h-2 bg-ink/70" />
          <div className="h-2 bg-ink/40" />
          <div className={`h-2 ${r % 2 === 0 ? "bg-[var(--stage)]" : "bg-ink/25"}`} />
          <div className="h-2 bg-ink/40" />
        </div>
      ))}
    </div>
  );
}

export default function TheRound() {
  return (
    <section
      aria-labelledby="round-heading"
      className="round-section divide-t divide-b bg-paper-2"
    >
      <div className="mx-auto w-full max-w-5xl px-5 pt-20 sm:pt-28">
        <Reveal>
          <h2
            id="round-heading"
            className="max-w-3xl font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl"
          >
            One Lab for the <span className="text-accent">whole round.</span>
          </h2>
          <p className="mt-5 max-w-2xl text-lg font-medium leading-snug text-ink/70">
            Evidence flows from a search into a card, a card into a block, and a block into the
            Coach. Your citations carry through every step, so nothing gets lost as you move
            between tools.
          </p>
        </Reveal>
      </div>

      <div className="round-track">
        <div className="round-stage mx-auto w-full max-w-5xl px-5 pb-20 sm:pb-28">
          {/* Scroll rail. Hidden unless the stage is actually pinned and scrubbing.
              No column gap: each segment is exactly a sixth, which is what lets the
              playhead land dead centre on each one. */}
          <ol className="round-rail relative mt-12 grid-cols-6" aria-hidden>
            {STAGES.map((t, i) => (
              <li key={t.name} className="round-seg pr-3">
                <p className="round-seg-label label-mono flex items-center gap-1.5 text-[10px] text-ink">
                  <span aria-hidden className="inline-block h-2 w-2 shrink-0 rotate-45 bg-[var(--stage)]" />
                  {RAIL_LABELS[i]}
                </p>
                <div className="mt-2 h-[3px] w-full bg-ink/15">
                  <div className="round-seg-fill h-full w-full bg-[var(--stage)]" />
                </div>
              </li>
            ))}
            <li className="round-carry">
              <span aria-hidden className="block h-3 w-3 rotate-45 bg-ink" />
            </li>
          </ol>

          <div className="round-panels">
            {STAGES.map((tool, i) => (
              <article
                key={tool.name}
                className="round-panel grid gap-8 py-12 md:grid-cols-[1fr_0.8fr] md:items-center md:py-0"
              >
                <div>
                  <div className="flex items-center gap-4">
                    <span className="frame shadow-hard inline-flex items-center justify-center bg-[var(--stage)] px-3 py-1 font-display text-2xl font-extrabold leading-none text-[var(--stage-fg)] sm:text-3xl">
                      {tool.index}
                    </span>
                    <h3 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                      {tool.name}
                    </h3>
                  </div>

                  <p className="mt-5 max-w-md font-display text-xl font-bold leading-snug sm:text-2xl">
                    {tool.tagline}
                  </p>

                  <ul className="mt-5 grid max-w-md gap-2.5">
                    {tool.points.slice(0, 2).map((p) => (
                      <li key={p} className="flex items-start gap-2.5 text-sm font-medium leading-snug">
                        <span
                          aria-hidden
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rotate-45 bg-[var(--stage)]"
                        />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>

                  <p className="frame shadow-hard mt-7 inline-flex items-start gap-2 bg-[var(--stage)] px-3 py-2 text-sm font-bold text-[var(--stage-fg)]">
                    <span aria-hidden>→</span>
                    <span>{HANDOFF[i]}</span>
                  </p>
                </div>

                <div className="round-art w-full max-w-sm md:justify-self-end">
                  <Artifact stage={i} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
