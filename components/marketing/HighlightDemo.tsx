"use client";

import { useCallback, useRef } from "react";

/**
 * Interactive "highlight to card" moment. A correctly formatted cut card (white
 * document, black border, Calibri, 8pt greyed context, 11pt read-aloud underline,
 * #00ffff highlight — matching the real CardView) is carded by a highlighter that
 * sweeps across it on a loop, and follows the cursor on hover. Marks paint left
 * to right in proportion to the sweep position, driven by one rAF loop. Under
 * prefers-reduced-motion the card renders fully marked and static.
 *
 * The text is a neutral sample used to demonstrate the interface.
 */

type Seg = { t: string; k?: "u" | "h" };

// Body: plain segments render as 8pt greyed context; `u`/`h` as 11pt read-aloud.
const BODY: Seg[] = [
  { t: "Under current policy, " },
  { t: "warming will exceed two degrees this century", k: "u" },
  { t: ". " },
  { t: "Each year of delay ", k: "u" },
  { t: "raises the cost", k: "h" },
  { t: " of the transition and " },
  { t: "closes off pathways", k: "h" },
  { t: " that remain open today." },
];

const CYAN = "#00ffff";
const PERIOD = 5200; // full loop
const PAINT_END = 2600; // sweep paints across
const HOLD_END = 4200; // fully carded, held
const UNPAINT_END = 4700; // quick reverse un-paint, then a short pause

const CARD_FONT: React.CSSProperties = { fontFamily: "Calibri, 'Segoe UI', sans-serif" };

function markBaseStyle(kind: "u" | "h"): React.CSSProperties {
  const color = kind === "u" ? "#111111" : CYAN;
  return {
    backgroundImage: `linear-gradient(${color}, ${color})`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: kind === "u" ? "0 100%" : "0 62%",
    backgroundSize: kind === "u" ? "0% 2px" : "0% 82%",
    WebkitBoxDecorationBreak: "clone",
    boxDecorationBreak: "clone",
  };
}

export default function HighlightDemo() {
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const attach = useCallback((cardEl: HTMLDivElement | null) => {
    if (!cardEl) return;
    const body = bodyRef.current;
    const bar = barRef.current;
    if (!body) return;

    const state = {
      marks: [] as { el: HTMLElement; left: number; width: number; kind: string }[],
      W: 0,
      hoverX: null as number | null,
      start: 0,
      raf: 0,
    };

    const measure = () => {
      state.W = body.clientWidth;
      state.marks = Array.from(body.querySelectorAll<HTMLElement>("[data-kind]")).map((el) => ({
        el,
        left: el.offsetLeft,
        width: el.offsetWidth,
        kind: el.getAttribute("data-kind") ?? "u",
      }));
    };

    const paint = (sweepX: number) => {
      for (const m of state.marks) {
        const fill = Math.max(0, Math.min(1, (sweepX - m.left) / (m.width || 1)));
        const pct = (fill * 100).toFixed(1);
        m.el.style.backgroundSize = m.kind === "u" ? `${pct}% 2px` : `${pct}% 82%`;
      }
      if (bar) {
        bar.style.transform = `translateX(${sweepX}px)`;
        bar.style.opacity = sweepX > 1 && sweepX < state.W - 1 ? "1" : "0";
      }
    };

    measure();

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      paint(state.W + 9999); // fully carded, no motion
      return;
    }

    const frame = (now: number) => {
      let sweepX: number;
      if (state.hoverX != null) {
        sweepX = Math.max(0, Math.min(state.W, state.hoverX));
      } else {
        const t = (now - state.start) % PERIOD;
        if (t < PAINT_END) sweepX = state.W * (t / PAINT_END);
        else if (t < HOLD_END) sweepX = state.W;
        else if (t < UNPAINT_END) sweepX = state.W * (1 - (t - HOLD_END) / (UNPAINT_END - HOLD_END));
        else sweepX = 0;
      }
      paint(sweepX);
      state.raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      state.hoverX = e.clientX - body.getBoundingClientRect().left;
    };
    const onLeave = () => {
      state.hoverX = null;
      state.start = performance.now(); // resume the loop cleanly from the start
    };
    const onResize = () => measure();

    body.addEventListener("pointermove", onMove);
    body.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);
    state.start = performance.now();
    state.raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(state.raf);
      body.removeEventListener("pointermove", onMove);
      body.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <section aria-labelledby="hldemo-heading" className="mx-auto w-full max-w-4xl px-5 py-16 sm:py-20">
      <h2
        id="hldemo-heading"
        className="max-w-2xl font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-5xl"
      >
        Card it in <span className="text-accent">one pass.</span>
      </h2>
      <p className="mt-4 max-w-xl text-base font-medium text-ink/70">
        Move across the card to highlight it, or watch it card itself. Every mark is the
        author&apos;s own words.
      </p>

      <div ref={attach} className="frame shadow-hard-lg mt-10 border-[3px] border-black bg-white p-6 text-black sm:p-8" style={CARD_FONT}>
        <span className="label-mono inline-block border-[3px] border-black bg-black px-2 py-1 text-[10px] text-white">
          Cut Card
        </span>

        <p className="mt-4 text-[13pt] font-bold leading-snug">
          Two degrees of warming is <span className="underline">locked in</span> without immediate
          cuts.
        </p>

        <p className="mt-3 leading-snug">
          <span className="text-[11pt] font-bold">Rodriguez 24</span>{" "}
          <span className="text-[11pt] text-neutral-500">[Journal of Climate Policy, 2024]</span>
        </p>

        <p ref={bodyRef} className="relative mt-4 overflow-hidden leading-relaxed">
          <span
            ref={barRef}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-0 block w-7"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(0,255,255,0.4), transparent)",
              transform: "translateX(0)",
              opacity: 0,
            }}
          />
          {BODY.map((s, i) =>
            s.k ? (
              <span
                key={i}
                data-kind={s.k}
                className={
                  s.k === "h"
                    ? "relative z-10 text-[11pt] font-bold underline decoration-2"
                    : "relative z-10 text-[11pt]"
                }
                style={markBaseStyle(s.k)}
              >
                {s.t}
              </span>
            ) : (
              <span key={i} className="relative z-10 text-[8pt] text-neutral-500">
                {s.t}
              </span>
            ),
          )}
        </p>
      </div>
    </section>
  );
}
