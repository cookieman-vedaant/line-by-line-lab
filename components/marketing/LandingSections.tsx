import Link from "next/link";
import Reveal from "@/components/marketing/Reveal";
import {
  capabilityStats,
  PRICING,
  SITE,
  type Stat,
  TOOLS,
  USAGE_STATS,
} from "@/lib/siteContent";
import { getIndexedCardCount } from "@/services/wikiStats";

/** Red diamond — the site's recurring section marker. */
function Diamond() {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 rotate-45 bg-red" />;
}

/** Build the four-stat row from a live indexed-card count (null when unknown). */
function statsFor(indexedCards: number | null): Stat[] {
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
  return [...usage, ...capabilityStats(indexedCards)].slice(0, 4);
}

/** The rendered stat grid — shared by the live bar and its instant fallback. */
function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-2 divide-y divide-ink/10 sm:grid-cols-4 sm:divide-y-0">
      {stats.map((s) => (
        <div key={s.label} className="px-2 py-4 text-center sm:py-0">
          <dt className="font-display text-4xl font-extrabold tracking-tighter text-ink sm:text-5xl">
            {s.value}
          </dt>
          <dd className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink/65">
            {s.label}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Accomplishments strip. Real usage counts (lib/siteContent.ts) show first when
 * set, then the always-true capability stats — capped at four for a clean row.
 *
 * The indexed-card count is read live from the database so the figure can't
 * drift from reality as ingestion runs. That read MUST NOT block the page shell:
 * the page wraps this in <Suspense fallback={<StatBarFallback/>}>, so the static
 * row paints instantly and the live count streams in. (Before, this awaited the
 * DB read with no boundary, so a cold or loaded query stalled the whole landing
 * page for seconds.)
 */
export async function StatBar() {
  const indexedCards = await getIndexedCardCount();
  return <StatGrid stats={statsFor(indexedCards)} />;
}

/** Instant, DB-free stand-in for the Suspense fallback — same row, static count. */
export function StatBarFallback() {
  return <StatGrid stats={statsFor(null)} />;
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
          debater the same edge: reputable research, verbatim cards, and a coach on call, free to
          start, on any device.
        </p>
      </Reveal>
    </section>
  );
}

/* The prep loop that used to live here as a row of chips is now
   components/marketing/TheRound.tsx, which scrubs the same five stages by
   scroll position and shows what each one hands to the next. */

/** Capability list shared by every tool card. */
function PointList({ points, twoCol }: { points: string[]; twoCol?: boolean }) {
  return (
    <ul className={`mt-6 grid gap-x-8 gap-y-3 ${twoCol ? "sm:grid-cols-2" : ""}`}>
      {points.map((p) => (
        <li key={p} className="flex items-start gap-2.5 text-sm font-medium leading-snug">
          <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rotate-45 bg-accent" />
          <span>{p}</span>
        </li>
      ))}
    </ul>
  );
}

/** Full-width tool block for Find Articles and Coach. */
function FeaturedTool({ tool }: { tool: (typeof TOOLS)[number] }) {
  return (
    <article className="frame shadow-hard-lg flex h-full flex-col bg-paper-2 p-6 motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-1 sm:p-9">
      <div className="flex items-baseline gap-4">
        <span className="font-display text-4xl font-extrabold leading-none text-accent sm:text-5xl">
          {tool.index}
        </span>
        <h3 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          {tool.name}
        </h3>
      </div>
      <p className="mt-4 max-w-3xl font-display text-xl font-bold leading-snug text-ink sm:text-2xl">
        {tool.tagline}
      </p>
      <p className="mt-4 max-w-3xl text-sm font-medium leading-relaxed text-ink/75 sm:text-base">
        {tool.blurb}
      </p>
      <PointList points={tool.points} twoCol />
    </article>
  );
}

/** Standard tool card. Same weight and structure as the featured ones, one column. */
function GridTool({ tool }: { tool: (typeof TOOLS)[number] }) {
  return (
    <article className="frame shadow-hard flex h-full flex-col bg-paper-2 p-6 motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-1">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-3xl font-extrabold leading-none text-accent">
          {tool.index}
        </span>
        <h3 className="font-display text-2xl font-bold tracking-tight">{tool.name}</h3>
      </div>
      <p className="mt-3 font-display text-base font-bold leading-snug text-ink">{tool.tagline}</p>
      <p className="mt-3 text-sm font-medium leading-relaxed text-ink/75">{tool.blurb}</p>
      <div className="flex-1" />
      <PointList points={tool.points} />
    </article>
  );
}

/** The feature showcase. Find and Coach span full width; the rest pair up. */
export function Toolkit() {
  // scroll-mt keeps the heading clear of the sticky nav when jumped to from it —
  // don't rely on py-20 alone for that.
  return (
    <section
      aria-labelledby="toolkit-heading"
      id="tools"
      className="mx-auto w-full max-w-5xl scroll-mt-4 px-5 py-20"
    >
      <Reveal>
        <h2
          id="toolkit-heading"
          className="max-w-3xl font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl"
        >
          Eight tools. <span className="text-accent">One workflow.</span>
        </h2>
        <p className="mt-5 max-w-xl text-lg font-medium text-ink/70">
          Everything a round demands: research, disclosed prep, cards, your card library, opponent
          prep, coaching, and your own record, in one workspace.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        {TOOLS.map((t, i) => (
          <Reveal
            key={t.name}
            delay={Math.min(i, 4) * 50}
            className={t.featured ? "sm:col-span-2" : undefined}
          >
            {t.featured ? <FeaturedTool tool={t} /> : <GridTool tool={t} />}
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/** Free vs Pro. Pro is honestly "coming soon" — no fake checkout. */
export function Pricing() {
  return (
    <section
      aria-labelledby="pricing-heading"
      id="pricing"
      className="mx-auto w-full max-w-4xl scroll-mt-4 px-5 py-20"
    >
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
              className={`frame relative flex h-full flex-col bg-paper-2 p-6 motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-1 sm:p-8 ${
                tier.featured ? "shadow-hard-lg border-accent" : "shadow-hard"
              }`}
            >
              {tier.featured && (
                <span className="label-mono absolute -top-3 left-6 bg-accent px-2 py-1 text-[10px] font-bold text-paper">
                  coming soon
                </span>
              )}
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-ink/65">{tier.name}</p>
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
                    In the works. Free covers you today.
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
            <Link href="/docs" className="text-[11px] font-semibold uppercase tracking-wide text-ink/70 hover:text-accent">
              Docs
            </Link>
            <Link href="#pricing" className="text-[11px] font-semibold uppercase tracking-wide text-ink/70 hover:text-accent">
              Pricing
            </Link>
          </nav>
        </div>
        <div className="masthead-rule mt-8 h-[3px] w-full bg-ink" />
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-ink/40">
          © {SITE.copyrightYear} {SITE.name} · Built for Lincoln-Douglas, Public Forum &amp;
          Policy debaters · Never fabricates evidence
        </p>
      </div>
    </footer>
  );
}
