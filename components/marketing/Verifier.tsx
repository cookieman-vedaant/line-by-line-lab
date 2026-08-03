import Reveal from "@/components/marketing/Reveal";

/**
 * The Verifier — the check that runs on every card, drawn.
 *
 * A scan passes down the article and the cut card together; each line of the
 * card locks onto the line of the source it came from, and the sheet is stamped.
 * This is the one claim that separates the Lab from a chatbot, so it gets a
 * section rather than a sentence.
 *
 * All CSS: one looping timeline with a delay per row, animating transform and
 * opacity only. Nothing here is a canvas and nothing listens to scroll.
 * Wordless by design, so there is no article and no citation to invent.
 */

const ROWS = [
  { src: "92%", card: "78%" },
  { src: "74%", card: "88%" },
  { src: "88%", card: "62%" },
  { src: "66%", card: "84%" },
  { src: "82%", card: "70%" },
];

export default function Verifier() {
  return (
    <section
      aria-labelledby="verify-heading"
      className="mx-auto w-full max-w-5xl px-5 py-20 sm:py-24"
    >
      <Reveal>
        <h2
          id="verify-heading"
          className="max-w-3xl font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl"
        >
          Every word checked <span className="text-accent">against the source.</span>
        </h2>
        <p className="mt-5 max-w-2xl text-lg font-medium leading-snug text-ink/70">
          The Lab compares each line of a finished card back to the article it came from. A card
          that does not match is rejected and cut again, so what you read in round is the
          author&apos;s wording.
        </p>
      </Reveal>

      <Reveal delay={120}>
        <div className="verify mt-12">
          <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-x-4 gap-y-0 sm:gap-x-8">
            <p className="label-mono mb-3 text-[10px] text-ink/65">the article</p>
            <span aria-hidden />
            <p className="label-mono mb-3 text-right text-[10px] text-ink/65">your card</p>
          </div>

          <div className="verify-stage frame relative bg-paper-2 p-5 sm:p-7">
            {/* The scan itself: one line travelling down the pair. */}
            <span aria-hidden className="verify-scan" />

            <div className="relative z-10 flex flex-col gap-4">
              {ROWS.map((row, i) => (
                <div
                  key={i}
                  className="verify-row grid grid-cols-[1fr_auto_1fr] items-center gap-x-4 sm:gap-x-8"
                  style={{ animationDelay: `${i * 0.34}s` } as React.CSSProperties}
                >
                  <span className="verify-bar ml-auto" style={{ width: row.src }}>
                    <i className="verify-fill" />
                  </span>

                  <span aria-hidden className="verify-link" />

                  <span className="verify-bar" style={{ width: row.card }}>
                    <i className="verify-fill" />
                  </span>
                </div>
              ))}
            </div>

            <div className="verify-stamp frame shadow-hard absolute bottom-4 right-4 z-20 flex items-center gap-2 bg-accent px-3 py-1.5 sm:bottom-6 sm:right-6">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="m4 12 5 5L20 6"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-paper"
                />
              </svg>
              <span className="label-mono text-[10px] font-bold text-paper">verbatim</span>
            </div>
          </div>

          <p className="mt-4 text-sm font-medium text-ink/60">
            A card that fails this check never reaches you.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
