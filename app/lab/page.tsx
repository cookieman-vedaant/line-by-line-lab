import Link from "next/link";
import EvidenceWorkbench from "@/components/EvidenceWorkbench";
import HumanGate from "@/components/HumanGate";
import LiveCount from "@/components/LiveCount";
import ThemeStudio from "@/components/ThemeStudio";

// The app itself (Find Articles / Cut a Card / Coach). Reached from the landing
// page's "Get Started". Lives on its own route so a future auth layer can gate
// /lab without touching the intro page or any feature here.
export default function Lab() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-12 sm:py-16">
      <header className="mb-10 sm:mb-14">
        <div className="reveal reveal-1 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Home → the landing / Get Started page. When auth is added later,
                this still points at "/" (which becomes sign-in); no change needed. */}
            <Link
              href="/"
              aria-label="Back to the Get Started page"
              className="label-mono frame btn-press inline-flex items-center gap-1.5 bg-paper-2 px-3 py-1.5 text-[10px] font-bold text-ink hover:text-accent"
            >
              <span aria-hidden>←</span> Home
            </Link>
            <p className="label-mono hidden items-center gap-2 text-xs text-accent sm:flex">
              <span className="inline-block h-2.5 w-2.5 rotate-45 bg-red" />
              debate evidence engine
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <LiveCount />
            <ThemeStudio />
          </div>
        </div>

        <h1 className="reveal reveal-2 mt-4 font-display text-6xl font-extrabold leading-[0.9] tracking-tight sm:text-8xl">
          Line by
          <br />
          Line{" "}
          <span className="lab-mark frame shadow-hard inline-block -rotate-1 bg-accent px-3 pb-1 text-paper">
            Lab
          </span>
        </h1>

        <p className="reveal reveal-3 mt-6 max-w-md text-lg font-medium leading-snug">
          Find reputable evidence. Cut debate-ready cards.{" "}
          <span className="bg-yellow box-decoration-clone px-1 font-semibold text-black">
            In minutes.
          </span>
        </p>

        <div className="masthead-rule reveal reveal-3 mt-8 h-[3px] w-full bg-ink" />
      </header>

      <div className="reveal reveal-4">
        {/* Human gate (Turnstile). Off unless a site key is configured; when on,
            the workbench (and its API calls) unlock only after the check. */}
        <HumanGate>
          <EvidenceWorkbench />
        </HumanGate>
      </div>
    </main>
  );
}
