import Link from "next/link";
import {
  CAPABILITY_STATS,
  PRICING,
  SITE,
  type Stat,
  TOOLS,
  USAGE_STATS,
} from "@/lib/siteContent";

/** Small red diamond used across the site as a section marker. */
function Diamond() {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 rotate-45 bg-red" />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="label-mono flex items-center justify-center gap-2 text-xs text-accent">
      <Diamond />
      {children}
    </p>
  );
}

/**
 * Accomplishments strip. Shows any REAL usage counts you've filled in
 * (lib/siteContent.ts) first, then the always-true capability stats — capped at
 * four so it stays a clean single row. Never shows a number that isn't set.
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
    <dl className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="text-center">
          <dt className="font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
            {s.value}
          </dt>
          <dd className="label-mono mt-1 text-[10px] leading-tight text-ink/60">{s.label}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Compact "what's inside" overview — the five tool names at a glance. */
export function ToolStrip() {
  return (
    <ul className="flex flex-wrap justify-center gap-2">
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

/** The mission — the heart of the pitch. */
export function Mission() {
  return (
    <section aria-labelledby="mission-heading" className="mx-auto w-full max-w-4xl px-5 py-20 sm:py-28">
      <SectionLabel>our mission</SectionLabel>
      <blockquote
        id="mission-heading"
        className="mt-8 text-center font-display text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl"
      >
        Debate shouldn&apos;t be a competition of who has the better prep and goes to the{" "}
        <span className="bg-yellow box-decoration-clone px-1 text-black">larger school.</span> The
        Line by Line Lab exists to{" "}
        <span className="text-accent">close the gap and balance the scales</span> for all debaters.
      </blockquote>
      <div className="masthead-rule mx-auto mt-12 h-[3px] w-full max-w-md bg-ink" />
      <p className="mx-auto mt-6 max-w-2xl text-center text-base font-medium leading-relaxed text-ink/70">
        The biggest programs have coaches pulling evidence around the clock. The Lab gives every
        debater that same edge — reputable research, verbatim cards, and a real coach — free to
        start, on any device.
      </p>
    </section>
  );
}

/** The detailed, one-by-one feature showcase. */
export function Toolkit() {
  return (
    <section aria-labelledby="toolkit-heading" id="tools" className="mx-auto w-full max-w-5xl px-5 py-16">
      <div className="text-center">
        <SectionLabel>the toolkit</SectionLabel>
        <h2
          id="toolkit-heading"
          className="mt-5 font-display text-4xl font-extrabold tracking-tight sm:text-6xl"
        >
          Five tools. <span className="text-accent">One workflow.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base font-medium text-ink/70">
          Most debaters stitch together five apps and hope for the best. The Lab does the whole
          prep loop in one place.
        </p>
      </div>

      <div className="mt-12 flex flex-col gap-5">
        {TOOLS.map((t) => (
          <article
            key={t.name}
            className="frame shadow-hard grid gap-5 bg-paper-2 p-6 sm:grid-cols-[auto_1fr] sm:p-8"
          >
            <p className="font-display text-5xl font-extrabold leading-none text-accent sm:text-6xl">
              {t.index}
            </p>
            <div>
              <h3 className="font-display text-2xl font-bold tracking-tight">{t.name}</h3>
              <p className="mt-1 font-display text-lg font-semibold text-ink/80">
                <span className="bg-yellow box-decoration-clone px-1 text-black">{t.tagline}</span>
              </p>
              <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed text-ink/70">
                {t.blurb}
              </p>
              <ul className="mt-4 flex flex-col gap-1.5">
                {t.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm font-medium">
                    <span aria-hidden className="mt-0.5 font-display font-bold text-accent">
                      ✓
                    </span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Free vs Pro. Pro is honestly marked "coming soon" — no fake checkout. */
export function Pricing() {
  return (
    <section aria-labelledby="pricing-heading" id="pricing" className="mx-auto w-full max-w-4xl px-5 py-16">
      <div className="text-center">
        <SectionLabel>pricing</SectionLabel>
        <h2
          id="pricing-heading"
          className="mt-5 font-display text-4xl font-extrabold tracking-tight sm:text-6xl"
        >
          Start free. <span className="text-accent">Go Pro when you&apos;re hooked.</span>
        </h2>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-2">
        {PRICING.map((tier) => (
          <div
            key={tier.name}
            className={`frame relative flex flex-col bg-paper-2 p-6 sm:p-8 ${
              tier.featured ? "shadow-hard-lg border-accent" : "shadow-hard"
            }`}
          >
            {tier.featured && (
              <span className="label-mono absolute -top-3 left-6 bg-accent px-2 py-1 text-[10px] font-bold text-paper">
                coming soon
              </span>
            )}
            <p className="label-mono text-xs text-ink/60">{tier.name}</p>
            <p className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
              {tier.price}
            </p>
            {tier.cadence && (
              <p className="label-mono mt-1 text-[11px] text-ink/50">{tier.cadence}</p>
            )}
            <p className="mt-4 text-sm font-medium leading-relaxed text-ink/70">{tier.blurb}</p>
            <ul className="mt-5 flex flex-col gap-2">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm font-medium">
                  <span aria-hidden className="mt-0.5 font-display font-bold text-accent">
                    ✓
                  </span>
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
                <p className="label-mono frame block bg-paper px-5 py-3 text-center text-[11px] text-ink/50">
                  In the works — free covers you today
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Closing call-to-action that scrolls back to the sign-up form. */
export function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-16 text-center">
      <h2 className="font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
        Level the field.
        <br />
        <span className="text-accent">Cut your first card free.</span>
      </h2>
      <div className="mt-8 flex justify-center">
        <Link
          href="#start"
          className="btn-press frame shadow-hard inline-flex items-center gap-2 bg-accent px-8 py-4 font-display text-lg font-bold uppercase tracking-wide text-paper"
        >
          Start free <span aria-hidden>→</span>
        </Link>
      </div>
      <p className="label-mono mt-4 text-[11px] text-ink/50">
        No credit card · works on any device · built for LD, PF &amp; Policy
      </p>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="divide-t mt-8">
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
            <Link href="/privacy" className="label-mono text-[11px] text-ink/70 hover:text-accent">
              Privacy Policy
            </Link>
            <Link href="#tools" className="label-mono text-[11px] text-ink/70 hover:text-accent">
              Features
            </Link>
            <Link href="#pricing" className="label-mono text-[11px] text-ink/70 hover:text-accent">
              Pricing
            </Link>
          </nav>
        </div>
        <div className="masthead-rule mt-8 h-[3px] w-full bg-ink" />
        <p className="label-mono mt-4 text-[10px] text-ink/40">
          © {new Date().getFullYear()} {SITE.name} · Built for Lincoln-Douglas, Public Forum &amp;
          Policy debaters · Never fabricates evidence
        </p>
      </div>
    </footer>
  );
}
