import Reveal from "@/components/marketing/Reveal";
import { TOOLS } from "@/lib/siteContent";

/**
 * The Round — the five stages of prep, scrubbed by scroll position. On a desktop
 * viewport that supports scroll-driven animations the stage pins and each stage
 * cross-fades as you scroll through it; everywhere else the same five panels read
 * as a plain vertical list. All of the motion lives in globals.css (`.round-*`),
 * driven by a view timeline rather than a scroll listener, so it never competes
 * with the main thread.
 *
 * The artifacts are deliberately wordless: structure only, no titles, authors, or
 * citations. Every line of prose comes from lib/siteContent, so the claims here
 * are the same ones the Toolkit makes.
 */

/** The workflow loop: the five tools a round actually passes through. */
const STAGES = TOOLS.slice(0, 5);

const RAIL_LABELS = ["Find", "Cut", "Re-Highlight", "Coach", "Record"];

/** What each stage hands to the next. This is the argument for one workspace. */
const HANDOFF = [
  "Send any result straight into the Cutter.",
  "The cut card carries its cite wherever it goes next.",
  "The contradiction report drops into your block.",
  "Blocks and cards come back ready to read.",
  "Your results sharpen the coaching you get next.",
];

/** A wordless stand-in for what the stage produces. Structure, never content. */
function Artifact({ stage }: { stage: number }) {
  if (stage === 0) {
    return (
      <div className="frame shadow-hard bg-paper p-4">
        {[92, 74, 86, 64].map((w, i) => (
          <div key={i} className="flex items-start gap-3 py-2">
            <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rotate-45 bg-red" />
            <div className="min-w-0 flex-1">
              <div className="h-2 bg-accent" style={{ width: `${w}%` }} />
              <div className="mt-1.5 h-1.5 w-2/5 bg-ink/25" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (stage === 1 || stage === 2) {
    const undercut = stage === 2;
    return (
      <div className="frame shadow-hard bg-paper p-4">
        <div className="h-3 w-4/5 bg-ink" />
        <div className="mt-1.5 h-3 w-3/5 bg-ink" />
        <div className="mt-3 h-2 w-2/5 bg-ink/45" />
        <div className="mt-4 flex flex-col gap-1.5">
          <div className="h-1.5 w-full bg-ink/20" />
          <div className="h-2 w-11/12 bg-ink/70" />
          <div className="relative h-2 w-3/4 bg-accent">
            {undercut && (
              <span aria-hidden className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-red" />
            )}
          </div>
          <div className="h-1.5 w-5/6 bg-ink/20" />
          {undercut ? (
            <div className="mt-1 flex items-center gap-2">
              <span aria-hidden className="h-2 w-2 shrink-0 rotate-45 bg-red" />
              <div className="h-2 flex-1 bg-ink/70" />
            </div>
          ) : (
            <div className="h-2 w-2/3 bg-ink/70" />
          )}
        </div>
      </div>
    );
  }

  if (stage === 3) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="frame w-4/5 bg-paper p-3">
          <div className="h-2 w-full bg-ink/25" />
          <div className="mt-1.5 h-2 w-3/5 bg-ink/25" />
        </div>
        <div className="frame shadow-hard w-3/5 self-end bg-accent p-3">
          <div className="h-2 w-full bg-paper/85" />
          <div className="mt-1.5 h-2 w-2/3 bg-paper/85" />
        </div>
        <div className="frame w-11/12 bg-paper p-3">
          <div className="h-2.5 w-3/4 bg-ink" />
          <div className="mt-2 h-1.5 w-2/5 bg-ink/40" />
          <div className="mt-2 h-2 w-5/6 bg-ink/60" />
        </div>
      </div>
    );
  }

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
          <div className={`h-2 ${r % 2 === 0 ? "bg-accent" : "bg-red"}`} />
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
          {/* Scroll rail. Hidden unless the stage is actually pinned and scrubbing. */}
          <ol className="round-rail mt-12 grid-cols-5 gap-3" aria-hidden>
            {STAGES.map((t, i) => (
              <li key={t.name} className="round-seg">
                <p className="round-seg-label label-mono text-[10px] text-ink">
                  <span className="text-accent">{t.index}</span> {RAIL_LABELS[i]}
                </p>
                <div className="mt-2 h-[3px] w-full bg-ink/15">
                  <div className="round-seg-fill h-full w-full bg-accent" />
                </div>
              </li>
            ))}
          </ol>

          <div className="round-panels">
            {STAGES.map((tool, i) => (
              <article
                key={tool.name}
                className="round-panel grid gap-8 py-12 md:grid-cols-[1fr_0.8fr] md:items-center md:py-0"
              >
                <div>
                  <div className="flex items-baseline gap-3">
                    <span className="font-display text-4xl font-extrabold leading-none text-accent sm:text-5xl">
                      {tool.index}
                    </span>
                    <h3 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                      {tool.name}
                    </h3>
                  </div>

                  <p className="mt-4 max-w-md font-display text-xl font-bold leading-snug sm:text-2xl">
                    {tool.tagline}
                  </p>

                  <ul className="mt-5 grid max-w-md gap-2.5">
                    {tool.points.slice(0, 2).map((p) => (
                      <li key={p} className="flex items-start gap-2.5 text-sm font-medium leading-snug">
                        <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rotate-45 bg-accent" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-6 flex items-start gap-2 text-sm font-bold text-accent">
                    <span aria-hidden>→</span>
                    <span>{HANDOFF[i]}</span>
                  </p>
                </div>

                <div className="w-full max-w-sm md:justify-self-end">
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
