"use client";

import { useCallback, useState } from "react";

/**
 * The signature moment: a plain article paragraph cuts itself into a formatted
 * card. The tag sets, the underlines draw left to right, the highlights swipe on,
 * and the cite lands last. It shows exactly what the app does, so the effect is
 * also the pitch. CSS-only (gradient background-size swipes), triggered when the
 * card scrolls into view via a callback ref, and instant + transition-free under
 * prefers-reduced-motion.
 *
 * The text is a neutral sample used to demonstrate the interface, not a real
 * citation.
 */

type Seg = { t: string; k?: "u" | "h" };

// Sample card body. `u` = read-aloud underline, `h` = stressed highlight.
const BODY: Seg[] = [
  { t: "Current policy leaves the planet on track to " },
  { t: "exceed two degrees of warming this century", k: "u" },
  { t: ", and the window to change course keeps narrowing. " },
  { t: "Each year of delay " },
  { t: "raises the eventual cost", k: "h" },
  { t: " of the transition and " },
  { t: "removes low-carbon pathways", k: "h" },
  { t: " that are still open today." },
];

// Step order for the staggered reveal (tag, then each mark, then cite).
const STEP_MS = 260;
const TAG_DELAY = 250;

export default function CutDemo() {
  const [playing, setPlaying] = useState(false);
  const [reduce, setReduce] = useState(false);

  const attach = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setReduce(true);
      setPlaying(true);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setPlaying(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setPlaying(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Assign each animated mark its own step so they land in reading order.
  let step = 0;
  const marks = BODY.map((s) => (s.k ? step++ : -1));
  const lastDelay = TAG_DELAY + step * STEP_MS;

  const markStyle = (kind: "u" | "h", delay: number): React.CSSProperties => {
    const color = kind === "u" ? "var(--ink)" : "var(--yellow)";
    const size = kind === "u" ? "2px" : "82%";
    return {
      backgroundImage: `linear-gradient(${color}, ${color})`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: kind === "u" ? "0 100%" : "0 62%",
      backgroundSize: playing ? `100% ${size}` : `0% ${size}`,
      transition: reduce ? "none" : `background-size .5s cubic-bezier(.2,.9,.3,1) ${delay}ms`,
      color: "var(--ink)",
      fontWeight: kind === "h" ? 600 : 500,
      paddingBottom: kind === "u" ? "1px" : undefined,
      WebkitBoxDecorationBreak: "clone",
      boxDecorationBreak: "clone",
    };
  };

  const fade = (delay: number): React.CSSProperties => ({
    opacity: playing ? 1 : 0,
    transform: playing ? "none" : "translateY(6px)",
    transition: reduce ? "none" : `opacity .45s ease ${delay}ms, transform .45s ease ${delay}ms`,
  });

  return (
    <section aria-labelledby="cutdemo-heading" className="mx-auto w-full max-w-4xl px-5 py-16 sm:py-20">
      <h2
        id="cutdemo-heading"
        className="max-w-2xl font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-5xl"
      >
        Watch a card <span className="text-accent">cut itself.</span>
      </h2>
      <p className="mt-4 max-w-xl text-base font-medium text-ink/70">
        Every underline and highlight is the author&apos;s own words, verified against the source.
      </p>

      <div ref={attach} className="frame shadow-hard-lg mt-10 bg-paper-2 p-6 sm:p-8">
        <div className="label-mono mb-4 flex items-center justify-between text-[10px] text-ink/45">
          <span>cut card</span>
          <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-red" />
        </div>

        <p
          className="font-display text-lg font-bold leading-snug sm:text-xl"
          style={fade(TAG_DELAY)}
        >
          Two degrees of warming is locked in without immediate cuts.
        </p>

        <p className="mt-4 text-[15px] leading-relaxed text-ink/80">
          {BODY.map((s, i) =>
            s.k ? (
              <span key={i} style={markStyle(s.k, TAG_DELAY + marks[i] * STEP_MS)}>
                {s.t}
              </span>
            ) : (
              <span key={i}>{s.t}</span>
            ),
          )}
        </p>

        <p
          className="label-mono mt-5 text-[11px] text-ink/55"
          style={fade(lastDelay)}
        >
          Rodriguez 24, Journal of Climate Policy
        </p>
      </div>
    </section>
  );
}
