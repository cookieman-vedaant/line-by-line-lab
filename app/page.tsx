import EvidenceWorkbench from "@/components/EvidenceWorkbench";
import ThemeSwitcher from "@/components/ThemeSwitcher";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-12 sm:py-16">
      <header className="mb-10 sm:mb-14">
        <div className="reveal reveal-1 flex items-center justify-between gap-4">
          <p className="label-mono flex items-center gap-2 text-xs text-accent">
            <span className="inline-block h-2.5 w-2.5 rotate-45 bg-red" />
            debate evidence engine
          </p>
          <ThemeSwitcher />
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
        <EvidenceWorkbench />
      </div>
    </main>
  );
}
