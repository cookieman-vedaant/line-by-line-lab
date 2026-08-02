import Link from "next/link";
import Reveal from "@/components/marketing/Reveal";
import {
  CAPABILITY_STATS,
  PRICING,
  SITE,
  type Stat,
  TOOLS,
  USAGE_STATS,
} from "@/lib/siteContent";

/** Red diamond — the site's recurring section marker. */
function Diamond() {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 rotate-45 bg-red" />;
}

/**
 * Accomplishments strip. Real usage counts (lib/siteContent.ts) show first when
 * set, then the always-true capability stats — capped at four for a clean row.
 */
export function StatBar() {
  const usage: Stat[] = [];
  if (USAGE_STATS.cardsCut != null)
    usage.push({ value: `${USAGE_STATS.cardsCut.toLocaleString()}+`, label: "cards cut" });
  if (USAGE_STATS.cardsHighlighted != null)
    usage.push({
      value: `${USAGE_STATS.cardsHighlighted.toLocaleString()}+`,
      label: "cards re-highlighted",
    });
  if (USAGE_STATS.searchesRun != null)
    usage.push({ value: `${USAGE_STATS.searchesRun.toLocaleString()}+`, label: "searches run" });

  const stats = [...usage, ...CAPABILITY_STATS].slice(0, 4);

  return (
    <dl className="grid grid-cols-2 divide-y divide-ink/10 sm:grid-cols-4 sm:divide-y-0">
      {stats.map((s) => (
        <div key={s.label} className="px-2 py-4 text-center sm:py-0">
          <dt className="font-display text-4xl font-extrabold tracking-tighter text-ink sm:text-5xl">
            {s.value}
          </dt>
          <dd className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink/55">
            {s.label}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Compact "what's inside" overview — the tool names at a glance. */
export function ToolStrip() {
  return (
    <ul className="flex flex-wrap gap-2">
      {TOOLS.map((t) => (
        <li
          key={t.name}
          className="frame label-mono bg-paper-2 px-3 py-1.5 text-[11px] font-bold text-ink"
        >
          <span className="text-accent">{t.index}</span> {t.name}
        </li>
      ))}
    </ul>
  );
}

/** The mission — the emotional core of the pitch. */
export function Mission() {
  return (
    <section
      aria-labelledby="mission-heading"
      className="mx-auto w-full max-w-4xl px-5 py-24 sm:py-32"
    >
      <Reveal>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-accent">
          <Diamond />
          why we exist
        </p>
        <blockquote
          id="mission-heading"
          className="mt-7 font-display text-3xl font-extrabold leading-[1.06] tracking-tight sm:text-5xl"
        >
          Debate shouldn&apos;t be a competition of who has the better prep and goes to the{" "}
          <span className="bg-yellow box-decoration-clone px-1 text-black">larger school.</span>{" "}
          Line by Line Lab exists to{" "}
          <span className="text-accent">close the gap and balance the scales</span> for all
          debaters.
        </blockquote>
        <p className="mt-8 max-w-2xl text-base font-medium leading-relaxed text-ink/70">
          The biggest programs have coaches pulling evidence around the clock. The Lab hands every
          debater that same edge — reputable research, verbatim cards, and a coach that never sleeps
          — free to start, on any device.
        </p>
      </Reveal>
    </section>
  );
}

/** Versatility — the whole prep loop in one app, vs. single-trick alternatives. */
export function Versatility() {
  const loop = ["Find", "Cut", "Re-Highlight", "Coach", "Record"];
  return (
    <section
      aria-labelledby="versatility-heading"
      className="border-y-[3px] border-ink bg-paper-2 px-5 py-20 sm:py-28"
    >
      <div className="mx-auto w-full max-w-5xl">
        <Reveal>
          <h2
            id="versatility-heading"
            className="max-w-3xl font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl"
          >
            One Lab for the <span className="text-accent">whole round.</span>
          </h2>
          <p className="mt-5 max-w-2xl text-lg font-medium leading-snug text-ink/70">
            Other tools give you a search engine. Or a card cutter. Or an empty doc. The Lab is all
            of it, wired together — evidence flows from search, to card, to block, to coach, without
            ever leaving the page.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <ol className="mt-12 flex flex-wrap items-center gap-x-1 gap-y-3">
            {loop.map((step, i) => (
              <li key={step} className="flex items-center gap-1">
                <span className="frame shadow-hard bg-paper px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wide">
                  {step}
                </span>
                {i < loop.length - 1 && (
                  <span aria-hidden className="px-1 font-display text-2xl font-bold text-accent">
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-6 max-w-2xl text-sm font-medium leading-relaxed text-ink/60">
            No exporting, no copy-paste between five apps, no lost citations. That connective tissue
            is the whole point — and it&apos;s why one workspace beats a shelf of single-trick tools.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/** A large, featured tool block (Find Articles, Coach) with a capability grid. */
function FeaturedTool({ tool }: { tool: (typeof TOOLS)[number] }) {
  const isCoach = tool.name === "Coach";
  return (
    <article className="frame shadow-hard-lg bg-paper-2 p-6 sm:p-9">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-4">
          <span className="font-display text-4xl font-extrabold leading-none text-accent sm:text-5xl">
            {tool.index}
          </span>
          <h3 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            {tool.name}
          </h3>
        </div>
        {isCoach && (
          <span className="frame label-mono bg-accent px-2 py-1 text-[10px] font-bold text-paper">
            most versatile
          </span>
        )}
      </div>

      <p className="mt-4 max-w-3xl font-display text-xl font-bold leading-snug text-ink sm:text-2xl">
        {tool.tagline}
      </p>
      <p className="mt-4 max-w-3xl text-sm font-medium leading-relaxed text-ink/70 sm:text-base">
        {tool.blurb}
      </p>

      <ul className="mt-7 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {tool.points.map((p) => (
          <li key={p} className="flex items-start gap-2.5 text-sm font-medium leading-snug">
            <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rotate-45 bg-accent" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** A compact tool row for the supporting tools. */
function CompactTool({ tool }: { tool: (typeof TOOLS)[number] }) {
  return (
    <article className="frame shadow-hard grid gap-4 bg-paper-2 p-6 sm:grid-cols-[auto_1fr] sm:gap-6">
      <span className="font-display text-4xl font-extrabold leading-none text-ink/25">
        {tool.index}
      </span>
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 className="font-display text-xl font-bold tracking-tight">{tool.name}</h3>
          <p className="font-display text-sm font-semibold text-accent">{tool.tagline}</p>
        </div>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-ink/70">
          {tool.blurb}
        </p>
      </div>
    </article>
  );
}

/** The detailed feature showcase — featured tools loom large, supports stay tight. */
export function Toolkit() {
  return (
    <section aria-labelledby="toolkit-heading" id="tools" className="mx-auto w-full max-w-5xl px-5 py-20">
      <Reveal>
        <h2
          id="toolkit-heading"
          className="max-w-3xl font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl"
        >
          Six tools. <span className="text-accent">One workflow.</span>
        </h2>
        <p className="mt-5 max-w-xl text-lg font-medium text-ink/70">
          Everything a round demands — research, cards, opponent prep, coaching, and your own record
          — in a single workspace.
        </p>
      </Reveal>

      <div className="mt-12 flex flex-col gap-5">
        {TOOLS.map((t, i) => (
          <Reveal key={t.name} delay={Math.min(i, 3) * 60}>
            {t.featured ? <FeaturedTool tool={t} /> : <CompactTool tool={t} />}
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/** Free vs Pro. Pro is honestly "coming soon" — no fake checkout. */
export function Pricing() {
  return (
    <section aria-labelledby="pricing-heading" id="pricing" className="mx-auto w-full max-w-4xl px-5 py-20">
      <Reveal>
        <h2
          id="pricing-heading"
          className="font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl"
        >
          Start free. <span className="text-accent">Go Pro when you&apos;re hooked.</span>
        </h2>
      </Reveal>

      <div className="mt-12 grid gap-5 md:grid-cols-2">
        {PRICING.map((tier, i) => (
          <Reveal key={tier.name} delay={i * 90}>
            <div
              className={`frame relative flex h-full flex-col bg-paper-2 p-6 sm:p-8 ${
                tier.featured ? "shadow-hard-lg border-accent" : "shadow-hard"
              }`}
            >
              {tier.featured && (
                <span className="label-mono absolute -top-3 left-6 bg-accent px-2 py-1 text-[10px] font-bold text-paper">
                  coming soon
                </span>
              )}
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-ink/55">{tier.name}</p>
              <p className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
                {tier.price}
              </p>
              {tier.cadence && (
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  {tier.cadence}
                </p>
              )}
              <p className="mt-4 text-sm font-medium leading-relaxed text-ink/70">{tier.blurb}</p>
              <ul className="mt-5 flex flex-1 flex-col gap-2.5">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm font-medium">
                    <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rotate-45 bg-accent" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                {tier.status === "active" ? (
                  <Link
                    href="#start"
                    className="btn-press frame block bg-accent px-5 py-3 text-center font-display text-sm font-bold uppercase tracking-wide text-paper"
                  >
                    Start free →
                  </Link>
                ) : (
                  <p className="frame block bg-paper px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                    In the works — free covers you today
                  </p>
                )}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/** Closing call-to-action back to the sign-up form. */
export function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-24 text-center">
      <Reveal>
        <h2 className="font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
          Level the field.
          <br />
          <span className="text-accent">Cut your first card free.</span>
        </h2>
        <div className="mt-9 flex justify-center">
          <Link
            href="#start"
            className="btn-press frame shadow-hard inline-flex items-center gap-2 bg-accent px-8 py-4 font-display text-lg font-bold uppercase tracking-wide text-paper"
          >
            Start free <span aria-hidden>→</span>
          </Link>
        </div>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink/50">
          No credit card · works on any device · built for LD, PF &amp; Policy
        </p>
      </Reveal>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="divide-t mt-4">
      <div className="mx-auto w-full max-w-5xl px-5 py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md">
            <p className="font-display text-lg font-extrabold tracking-tight">
              Line by Line{" "}
              <span className="lab-mark frame inline-block -rotate-1 bg-accent px-2 text-paper">
                Lab
              </span>
            </p>
            <p className="mt-3 text-xs font-medium leading-relaxed text-ink/60">{SITE.mission}</p>
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-2">
            <Link href="/privacy" className="text-[11px] font-semibold uppercase tracking-wide text-ink/70 hover:text-accent">
              Privacy Policy
            </Link>
            <Link href="#tools" className="text-[11px] font-semibold uppercase tracking-wide text-ink/70 hover:text-accent">
              Features
            </Link>
            <Link href="#pricing" className="text-[11px] font-semibold uppercase tracking-wide text-ink/70 hover:text-accent">
              Pricing
            </Link>
          </nav>
        </div>
        <div className="masthead-rule mt-8 h-[3px] w-full bg-ink" />
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-ink/40">
          © {new Date().getFullYear()} {SITE.name} · Built for Lincoln-Douglas, Public Forum &amp;
          Policy debaters · Never fabricates evidence
        </p>
      </div>
    </footer>
  );
}
