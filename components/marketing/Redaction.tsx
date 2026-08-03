import Reveal from "@/components/marketing/Reveal";

/**
 * The Redaction — what an opponent's card leaves out, drawn.
 *
 * A card handed to you across the flow is a redaction: you get the lines the
 * other team chose, and the rest of the article may as well be blacked out. So
 * the page blacks it out, then lifts the bars outward from their card and flares
 * the lines the author wrote that the card was cut around.
 *
 * Server component, no client JS. All motion is CSS transform/opacity on a single
 * 11s loop (see `.redact-*` in globals.css), so it costs the compositor and
 * nothing else. Wordless by design: there is no article, author, or citation here
 * to get wrong.
 */

interface Band {
  left: string;
  width: string;
}
interface Row {
  w: string;
  /** Distance from their card, 0 = adjacent. Drives the outward peel stagger. */
  rank: number;
  found?: Band;
}

/** The article above their card. `rank` counts down, so the peel opens outward. */
const ABOVE: Row[] = [
  { w: "96%", rank: 4 },
  { w: "88%", rank: 3 },
  { w: "93%", rank: 2 },
  { w: "84%", rank: 1, found: { left: "6%", width: "58%" } },
  { w: "91%", rank: 0 },
];

/** Their card: three lines, highlighted the way they wanted you to read them. */
const CARD: { w: string; mark: Band }[] = [
  { w: "100%", mark: { left: "31%", width: "54%" } },
  { w: "100%", mark: { left: "0%", width: "57%" } },
  { w: "72%", mark: { left: "10%", width: "46%" } },
];

const BELOW: Row[] = [
  { w: "95%", rank: 0, found: { left: "22%", width: "63%" } },
  { w: "87%", rank: 1 },
  { w: "92%", rank: 2 },
  { w: "82%", rank: 3, found: { left: "4%", width: "49%" } },
  { w: "58%", rank: 4 },
];

/** One line of the surrounding article: its text, maybe a flare, and its blackout. */
function Line({ row }: { row: Row }) {
  return (
    <span
      className="redact-line"
      data-found={row.found ? "" : undefined}
      style={{ width: row.w, animationDelay: `${row.rank * 0.11}s` }}
    >
      <i className="redact-rule" />
      {row.found && (
        <i className="redact-found" style={{ left: row.found.left, width: row.found.width }} />
      )}
      <i className="redact-bar" />
    </span>
  );
}

export default function Redaction() {
  return (
    <section
      aria-labelledby="redaction-heading"
      className="mx-auto w-full max-w-5xl px-5 py-20 sm:py-24"
    >
      <Reveal>
        <h2
          id="redaction-heading"
          className="max-w-3xl font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl"
        >
          Their card is an excerpt. <span className="text-accent">Read the rest of it.</span>
        </h2>
        <p className="mt-5 max-w-2xl text-lg font-medium leading-snug text-ink/70">
          Paste an opponent&apos;s card or its source link. Re-Highlight pulls the full original
          article and surfaces the author&apos;s own verbatim lines that weaken how the card was
          highlighted.
        </p>
      </Reveal>

      <Reveal delay={120}>
        <div className="redaction frame shadow-hard mt-12 overflow-hidden bg-paper-2 p-5 sm:p-8">
          <div aria-hidden className="flex flex-col gap-[11px]">
            {ABOVE.map((row, i) => (
              <Line key={`a${i}`} row={row} />
            ))}
          </div>

          {/* Their card, as a sheet laid over the article rather than part of it. */}
          <div className="frame shadow-hard my-6 -rotate-[0.7deg] bg-paper p-4 sm:my-7 sm:p-5">
            <p className="label-mono mb-3 text-[10px] text-ink/65">their card</p>
            <div aria-hidden className="flex flex-col gap-[11px]">
              {CARD.map((row, i) => (
                <span key={`c${i}`} className="redact-line" data-card="" style={{ width: row.w }}>
                  <i className="redact-rule" />
                  <i
                    className="redact-mark"
                    style={{ left: row.mark.left, width: row.mark.width }}
                  />
                </span>
              ))}
            </div>
          </div>

          <div aria-hidden className="flex flex-col gap-[11px]">
            {BELOW.map((row, i) => (
              <Line key={`b${i}`} row={row} />
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-2">
          <span className="label-mono flex items-center gap-2 text-[11px] text-ink/65">
            <i aria-hidden className="block h-2.5 w-6 bg-accent" />
            what they highlighted
          </span>
          <span className="label-mono flex items-center gap-2 text-[11px] text-ink/65">
            <i aria-hidden className="redact-swatch block h-2.5 w-6" />
            what the author also said
          </span>
        </div>

        <p className="mt-4 max-w-2xl text-sm font-medium text-ink/65">
          Every line it surfaces is quoted verbatim. When nothing in the article contradicts the
          card, it says the card holds up.
        </p>
      </Reveal>
    </section>
  );
}
