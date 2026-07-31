import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Line by Line Lab — debate evidence, cut in minutes",
  description:
    "Find reputable, readable evidence, cut debate-ready cards, and coach your case. Built for Lincoln-Douglas debaters.",
};

const FEATURES: [string, string, string][] = [
  ["01", "Find Articles", "Reputable sources, verified readable — not just abstracts."],
  ["02", "Cut a Card", "Verbatim, formatted, ready to read in-round."],
  ["03", "Coach", "Real feedback on your own case — upload it as a PDF."],
];

/**
 * Landing / intro page (route "/"). Its only job is to introduce the app and
 * hand off to it via "Get Started". The app lives at /lab and is completely
 * independent — this page imports none of its logic, so it can't affect any
 * feature.
 *
 * FUTURE AUTH: when a login + payment system is added, this page becomes the
 * sign-in / sign-up surface and the CTA below points at the auth flow (or auth
 * gates /lab via middleware). Nothing in /lab needs to change for that.
 */
export default function Landing() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start justify-center px-5 py-16 sm:py-24">
      <p className="reveal reveal-1 label-mono flex items-center gap-2 text-xs text-accent">
        <span className="inline-block h-2.5 w-2.5 rotate-45 bg-red" />
        debate evidence engine
      </p>

      <h1 className="reveal reveal-2 mt-5 font-display text-6xl font-extrabold leading-[0.88] tracking-tight sm:text-8xl">
        Line by
        <br />
        Line{" "}
        <span className="lab-mark frame shadow-hard inline-block -rotate-1 bg-accent px-3 pb-1 text-paper">
          Lab
        </span>
      </h1>

      <p className="reveal reveal-3 mt-7 max-w-xl text-xl font-medium leading-snug">
        Find reputable, readable evidence, cut debate-ready cards, and get a real
        coach for your case.{" "}
        <span className="bg-yellow box-decoration-clone px-1 font-semibold text-black">
          In minutes, not hours.
        </span>
      </p>

      <ul className="reveal reveal-3 mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {FEATURES.map(([n, title, desc]) => (
          <li key={n} className="frame bg-paper-2 px-4 py-3 sm:max-w-[13rem] sm:flex-1">
            <p className="label-mono text-[10px] text-accent">{n}</p>
            <p className="mt-0.5 font-display text-sm font-bold">{title}</p>
            <p className="mt-1 text-xs font-medium leading-snug text-ink/70">{desc}</p>
          </li>
        ))}
      </ul>

      {/* CTA — the single entry point into the app. Swap this href for the auth
          flow when login is added; the app at /lab is unaffected. */}
      <div className="reveal reveal-4 mt-10">
        <Link
          href="/lab"
          className="btn-press frame shadow-hard inline-flex items-center gap-2 bg-accent px-7 py-4 font-display text-lg font-bold uppercase tracking-wide text-paper"
        >
          Get Started <span aria-hidden>→</span>
        </Link>
      </div>

      <div className="masthead-rule reveal reveal-4 mt-12 h-[3px] w-full bg-ink" />
      <p className="reveal reveal-4 mt-4 label-mono text-[10px] text-ink/50">
        Free · No account needed · Built for Lincoln-Douglas debaters
      </p>
    </main>
  );
}
