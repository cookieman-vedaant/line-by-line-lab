import Reveal from "@/components/marketing/Reveal";
import { TOOLS } from "@/lib/siteContent";

/**
 * The Scales — the mission rendered as an apparatus. A beam sits heavy on the
 * side of the program with coaching hours to spare, then the six tools drop onto
 * the other end one at a time and it swings level.
 *
 * All of the motion is CSS, driven by a single registered custom property
 * (`--load` in globals.css), so the beam angle, the upright loads, and the chip
 * drops cannot desync. Nothing here renders evidence text, a citation, or a
 * source: the argument is the geometry. Colors come from theme tokens, so it
 * re-skins with the Theme Studio.
 */

/** Widths of the stacked slabs on the heavy end, in px. Uneven, like real paper. */
const SLABS = [104, 88, 112, 94, 100];

export default function Scales() {
  return (
    <section
      aria-labelledby="scales-heading"
      className="mx-auto w-full max-w-5xl overflow-hidden px-5 py-20 sm:py-28"
    >
      <Reveal>
        <h2
          id="scales-heading"
          className="max-w-2xl font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl"
        >
          Put six tools on <span className="text-accent">your side.</span>
        </h2>
        <p className="mt-5 max-w-xl text-lg font-medium leading-snug text-ink/70">
          Big programs run on coaching hours you don&apos;t have. The Lab does that research
          with you in minutes, free to start.
        </p>
      </Reveal>

      <Reveal delay={140}>
        <div className="scales relative mt-14 h-[268px] w-full sm:mt-16 sm:h-[330px]">
          {/* Ground */}
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-ink" />

          {/* Pedestal */}
          <div
            aria-hidden
            className="absolute bottom-[3px] left-1/2 h-[70px] w-[46px] -translate-x-1/2 bg-ink"
            style={{ clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }}
          />

          {/* Fulcrum */}
          <div
            aria-hidden
            className="absolute bottom-[64px] left-1/2 z-10 h-4 w-4 -translate-x-1/2 rotate-45 bg-red"
          />

          {/* The beam, and the two loads riding on it */}
          <div
            aria-hidden
            className="scales-beam absolute inset-x-2 bottom-[76px] h-[12px] bg-ink sm:inset-x-8"
          >
            {/* Heavy end: a stack of prep that never had to be shared */}
            <div className="scales-upright absolute bottom-full left-0 origin-bottom-left pb-2">
              <div className="flex flex-col gap-1">
                {SLABS.map((w, i) => (
                  <div key={i} className="h-3 bg-ink" style={{ width: `${w}px` }} />
                ))}
              </div>
            </div>

            {/* Your end: the tools land one at a time */}
            <div className="scales-upright absolute bottom-full right-0 origin-bottom-right pb-2">
              <div className="grid grid-cols-3 gap-1.5">
                {TOOLS.map((t, i) => (
                  <span
                    key={t.name}
                    style={{ "--i": String(i) } as React.CSSProperties}
                    className="scales-chip frame flex h-9 w-9 items-center justify-center bg-accent font-display text-[11px] font-bold text-paper"
                  >
                    {t.index}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Horizon. Runs the full width, past both ends of the beam, and paints
              over it — so the beam reads as coming to rest on a level line. Drawn
              after the beam for that overlap; the fulcrum stays on top of both. */}
          <div
            aria-hidden
            className="scales-level absolute inset-x-0 bottom-[81px] h-[2px] bg-accent"
          />
        </div>

        <div className="mt-4 flex items-start justify-between gap-6">
          <p className="label-mono text-[11px] text-ink/65">the big program</p>
          <p className="label-mono text-right text-[11px] text-ink/65">you, with the Lab</p>
        </div>
      </Reveal>
    </section>
  );
}
