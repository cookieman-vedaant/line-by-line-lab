import Reveal from "@/components/marketing/Reveal";

/**
 * Card Cut — the product's own output, cutting itself. A REAL, verbatim card
 * (Weinstein '24, Georgia Law Review — pulled from the disclosed index, with the
 * debater's ACTUAL emphasis) rendered in the Lab's real cut-card format (white
 * sheet, 3px black borders, Calibri; the underline / cyan-highlight / bold layers
 * from lib/cardRich.ts). The body starts fully UNFORMATTED — plain black text —
 * and the real formatting sweeps in WORD BY WORD, left to right, on a loop.
 *
 * Nothing is invented: the cite and every word are real; the emphasis is the
 * debater's own. Motion is CSS (`.cut-*` in globals.css) driven by one shared
 * `--cut-progress` sweep, so the wave is clean and cheap. Reduced motion renders
 * the finished, fully-formatted card.
 */
type Seg = { t: string; k: "p" | "u" | "h"; b?: 1 };

const TAG = "Big pharma makes minor changes to extend patent lifetime, crowding out competition.";
const CITE = "Weinstein 24";
const DETAILS =
  "Samuel Weinstein, professor at the Benjamin N. Cardozo School of Law; Christopher Buccafusco, professor of law at Duke University, 1/31/2024, “Antisocial Innovation,” Georgia Law Review: Vol. 58: No. 2.";

const PARAS: Seg[][] = [
  [
    { t: "Altering", k: "h" }, { t: " products ", k: "u" }, { t: "to harm competition is", k: "h" },
    { t: " a ", k: "p" }, { t: "common", k: "h" }, { t: " strategy ", k: "p" },
    { t: "in the pharmaceutical sector", k: "u" }, { t: " too. ", k: "p" }, { t: "Firms with", k: "h" },
    { t: " successful ", k: "u" }, { t: "drugs whose patents are ", k: "h" },
    { t: "near expiration will sometimes ", k: "p" }, { t: "modify the drugs in ", k: "u" },
    { t: "minor ways", k: "p" }, { t: " to extend", k: "u" }, { t: " their ", k: "p" },
    { t: "patent rights and ", k: "u" }, { t: "exclude generic ", k: "p" }, { t: "rivals", k: "h" },
    { t: " poised to enter the market.242 For example, ", k: "p" }, { t: "a drug maker ", k: "u" },
    { t: "might change", k: "h" }, { t: " the ", k: "u" }, { t: "form", k: "h" },
    { t: " of its drug, say ", k: "p" }, { t: "from", k: "u" }, { t: " a ", k: "p" },
    { t: "tablet to", k: "u" }, { t: " a ", k: "p" }, { t: "capsule, ", k: "u" }, { t: "or", k: "h" },
    { t: " alter the ", k: "u" }, { t: "number of doses", k: "h" },
    { t: " required by changing from an immediate-release to an extended-release formulation.243 ", k: "p" },
    { t: "These ", k: "u" }, { t: "changes", k: "h" }, { t: " might ", k: "p" }, { t: "offer no", k: "h" },
    { t: " (or limited) real ", k: "p" }, { t: "benefits", k: "h" }, { t: " to consumers, ", k: "p" },
    { t: "but", k: "h" }, { t: " the ", k: "u" }, { t: "manufacturer", k: "h" }, { t: " is able to ", k: "u" },
    { t: "secure a patent", k: "h" }, { t: " on the new formulation ", k: "p" }, { t: "and extend", k: "h" },
    { t: " its", k: "u" }, { t: " ability to charge ", k: "p" }, { t: "monopoly prices", k: "h" },
    { t: " for the drug. This strategy, termed “product hopping,” has faced antitrust scrutiny in a number of cases.244", k: "p" },
  ],
  [
    { t: "In each of these scenarios, ", k: "p" }, { t: "firms create products that", k: "u" },
    { t: ", while new, ", k: "p" }, { t: "offer", k: "u" }, { t: " little or nothing", k: "p" },
    { t: " in", k: "u" }, { t: " the way of ", k: "p" }, { t: "consumer benefits", k: "u" },
    { t: ". Instead, ", k: "p" }, { t: "these innovations", k: "u" },
    { t: " serve primarily to exclude competitors, ultimately ", k: "p" }, { t: "making ", k: "u" },
    { t: "consumers worse off. One might argue that ", k: "p" }, { t: "these", k: "u" },
    { t: " types of product ", k: "p" }, { t: "changes are ", k: "u" }, { t: "not innovation at all", k: "h" },
    { t: ". But, as we discuss below, antitrust law tends to treat any change to a product, unless it is clearly not an improvement, as an innovation requiring immunity from liability.245", k: "p" },
  ],
];

// Split each formatting segment into word tokens (word + trailing space), each
// with a running index so the CSS wave can reveal them left to right in order.
let wi = 0;
const RENDERED = PARAS.map((segs) => {
  const words: { t: string; k: Seg["k"]; b?: 1; i: number }[] = [];
  for (const seg of segs) {
    for (const part of seg.t.match(/\s*\S+\s*|\s+/g) ?? [seg.t]) {
      words.push({ t: part, k: seg.k, b: seg.b, i: wi++ });
    }
  }
  return words;
});
const WORD_COUNT = wi;

export default function CardCut() {
  return (
    <section
      aria-labelledby="cut-heading"
      className="mx-auto w-full max-w-4xl px-5 py-20 sm:py-28"
    >
      <Reveal>
        <h2
          id="cut-heading"
          className="max-w-2xl font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl"
        >
          Watch a card get <span className="text-accent">cut.</span>
        </h2>
        <p className="mt-5 max-w-xl text-lg font-medium leading-snug text-ink/70">
          Plain source in, a debate-ready card out — watch the real formatting fall into place, word
          by word, over the author&apos;s exact words.
        </p>
      </Reveal>

      <Reveal delay={140}>
        <article
          className="cut-card shadow-hard-lg mt-12 border-[3px] border-black bg-white p-6 text-black sm:mt-14 sm:p-8"
          style={{ fontFamily: "Calibri, 'Segoe UI', sans-serif" }}
        >
          <div className="mb-4 flex items-center justify-between gap-4 border-b-[3px] border-black pb-3">
            <span className="label-mono border-[3px] border-black bg-black px-2 py-1 text-[10px] text-white">
              CUT CARD
            </span>
            <span className="label-mono text-[10px] normal-case text-neutral-500">real · verbatim</span>
          </div>

          <h3 className="cut-tag font-bold leading-tight" style={{ fontSize: "13pt" }}>
            {TAG}
          </h3>

          <p className="cut-cite mt-2 leading-snug" style={{ fontSize: "11pt" }}>
            <span className="font-bold">{CITE}</span>{" "}
            <span style={{ color: "#808080" }}>[{DETAILS}]</span>
          </p>

          <div
            className="cut-body mt-3"
            style={{ "--cut-end": String(WORD_COUNT + 8) } as React.CSSProperties}
          >
            {RENDERED.map((words, pi) => (
              <p key={pi} className="cut-para">
                {words.map((w) => (
                  <span
                    key={w.i}
                    className={`cut-w k-${w.k}${w.b ? " cut-bold" : ""}`}
                    style={{ "--wi": String(w.i) } as React.CSSProperties}
                  >
                    {w.t}
                  </span>
                ))}
              </p>
            ))}
          </div>
        </article>
      </Reveal>
    </section>
  );
}
