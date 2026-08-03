"use client";

import { useCallback } from "react";
import Reveal from "@/components/marketing/Reveal";

/**
 * The Source Field — what a search actually does, drawn rather than described.
 * A field of ink ticks stands in for the index (OpenAlex and Semantic Scholar
 * together hold 250M+ works). A sweep line crosses it, almost everything dims,
 * and the handful that survive fly into a results panel on the right. Loops.
 *
 * Canvas rather than DOM so the field can be dense and still hold 60fps. The
 * clock is derived from one timestamp, so the animation is a pure function of
 * time and cannot drift. It pauses off-screen and while the tab is hidden,
 * re-reads theme tokens when the Theme Studio changes them, and renders one
 * static settled frame when motion is reduced.
 *
 * No text is drawn: there is no title, author, or citation to get wrong.
 */

const PERIOD = 8200;
const SWEEP_END = 2400;
const GATHER_END = 4100;
const RELEASE_START = 7000;

const STATIC_FRAME = 5200; // mid-hold: the settled, fully gathered state

interface Tick {
  x: number;
  y: number;
  a: number; // resting alpha
  s: number; // px
}

interface Result extends Tick {
  sx: number; // slot x
  sy: number; // slot y
  sw: number; // slot width
}

interface Palette {
  ink: string;
  accent: string;
  red: string;
  paper: string;
  radius: number;
  bw: number;
}

const ROW_H = 34; // per result row, incl. its source line
const BAR_H = 8;

/** Deterministic PRNG, so the field is identical on every mount and reload. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    ink: v("--ink", "#17130f"),
    accent: v("--accent", "#2f43ff"),
    red: v("--red", "#ff4a2e"),
    paper: v("--paper", "#f6efdf"),
    radius: Number.parseFloat(cs.getPropertyValue("--radius")) || 0,
    bw: Number.parseFloat(cs.getPropertyValue("--bw")) || 2,
  };
}

export default function SourceField() {
  const attach = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let palette = readPalette();
    let W = 0;
    let H = 0;
    let ticks: Tick[] = [];
    let results: Result[] = [];
    let panel = { x: 0, y: 0, w: 0, h: 0 };

    /** Size the backing store and lay out a fresh field for the current box. */
    const build = () => {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(rect.width));
      H = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const rng = mulberry32(20260802);
      const count = Math.min(1500, Math.max(240, Math.round((W * H) / 380)));
      const all: Tick[] = [];
      for (let i = 0; i < count; i += 1) {
        all.push({
          x: 6 + rng() * (W - 12),
          y: 8 + rng() * (H - 16),
          a: 0.14 + rng() * 0.26,
          s: rng() > 0.82 ? 3 : 2,
        });
      }

      const rows = Math.max(4, Math.min(8, Math.floor((H - 28) / ROW_H)));
      const pw = Math.min(320, Math.max(150, W * 0.34));
      const ph = rows * ROW_H + 18;
      panel = { x: W - pw - 8, y: Math.round((H - ph) / 2), w: pw, h: ph };

      // One survivor per vertical band, so the winners come from across the index.
      const taken = new Set<number>();
      const picked: Tick[] = [];
      for (let k = 0; k < rows; k += 1) {
        const lo = (W * k) / rows;
        const hi = (W * (k + 1)) / rows;
        let idx = all.findIndex((p, i) => !taken.has(i) && p.x >= lo && p.x < hi);
        if (idx < 0) idx = all.findIndex((_, i) => !taken.has(i));
        if (idx < 0) break;
        taken.add(idx);
        picked.push(all[idx]);
      }

      results = picked.map((p, k) => ({
        ...p,
        sx: panel.x + 26,
        sy: panel.y + 9 + ROW_H * k + (ROW_H - BAR_H - 8) / 2,
        sw: (panel.w - 42) * (0.68 + (0.32 * ((k * 7) % 11)) / 10),
      }));
      ticks = all.filter((_, i) => !taken.has(i));
    };

    const draw = (t: number) => {
      const { ink, accent, red, paper, radius, bw } = palette;
      ctx.clearRect(0, 0, W, H);

      // One clock: the sweep crosses, the results gather, everything unwinds.
      const fade =
        t < RELEASE_START ? 1 : 1 - easeInOut((t - RELEASE_START) / (PERIOD - RELEASE_START));
      const sweepX = Math.min(1, t / SWEEP_END) * (W + 80) - 40;
      const gather =
        t <= SWEEP_END
          ? 0
          : easeOutCubic(Math.min(1, (t - SWEEP_END) / (GATHER_END - SWEEP_END))) * fade;

      // The index
      ctx.fillStyle = ink;
      for (const p of ticks) {
        const hit = clamp01((sweepX - p.x) / 70) * fade;
        ctx.globalAlpha = p.a * (1 - 0.88 * hit);
        ctx.fillRect(p.x, p.y, p.s, p.s);
      }

      // The sweep
      if (sweepX < W + 40 && fade === 1) {
        const grad = ctx.createLinearGradient(sweepX - 34, 0, sweepX + 2, 0);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(1, accent);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = grad;
        ctx.fillRect(sweepX - 34, 0, 36, H);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = accent;
        ctx.fillRect(sweepX - 1.5, 0, 2, H);
      }

      // The results panel
      if (gather > 0.01) {
        ctx.beginPath();
        const r = Math.min(radius, 16);
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(panel.x, panel.y, panel.w, panel.h, r);
        } else {
          ctx.rect(panel.x, panel.y, panel.w, panel.h);
        }
        ctx.globalAlpha = gather;
        ctx.fillStyle = paper;
        ctx.fill();
        ctx.globalAlpha = gather * 0.85;
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, Math.min(3, bw));
        ctx.stroke();
      }

      // The survivors, in flight and then at rest
      for (const s of results) {
        const hit = clamp01((sweepX - s.x) / 70) * fade;
        const x = s.x + (s.sx - s.x) * gather;
        const y = s.y + (s.sy - s.y) * gather;
        const w = s.s + (s.sw - s.s) * gather;
        const h = s.s + (BAR_H - s.s) * gather;

        ctx.globalAlpha = s.a * (1 - hit);
        ctx.fillStyle = ink;
        ctx.fillRect(x, y, w, h);

        ctx.globalAlpha = hit;
        ctx.fillStyle = accent;
        ctx.fillRect(x, y, w, h);

        if (gather > 0.02) {
          // Source line under each result, and the diamond that marks the row.
          ctx.globalAlpha = gather * 0.4;
          ctx.fillStyle = ink;
          ctx.fillRect(x, y + h + 5, w * 0.46, 3);

          ctx.globalAlpha = gather * hit;
          ctx.fillStyle = red;
          ctx.save();
          ctx.translate(s.sx - 14, s.sy + BAR_H / 2);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-3.5, -3.5, 7, 7);
          ctx.restore();
        }
      }

      ctx.globalAlpha = 1;
    };

    build();

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      draw(STATIC_FRAME);
      const staticRo = new ResizeObserver(() => {
        build();
        draw(STATIC_FRAME);
      });
      staticRo.observe(canvas);
      return () => staticRo.disconnect();
    }

    let raf = 0;
    let t0 = performance.now();
    let clock = 0;
    let running = false;

    const frame = (now: number) => {
      clock = (now - t0) % PERIOD;
      draw(clock);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running) return;
      running = true;
      t0 = performance.now() - clock; // resume where it paused
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };

    let onScreen = false;
    const sync = () => {
      if (onScreen && !document.hidden) start();
      else stop();
    };

    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        sync();
      },
      { threshold: 0.05 },
    );
    io.observe(canvas);

    const ro = new ResizeObserver(() => {
      build();
      draw(clock);
    });
    ro.observe(canvas);

    // The Theme Studio rewrites tokens at runtime; pick the new ones up.
    const mo = new MutationObserver(() => {
      palette = readPalette();
      draw(clock);
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });

    document.addEventListener("visibilitychange", sync);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <section
      aria-labelledby="field-heading"
      className="mx-auto w-full max-w-5xl px-5 py-20 sm:py-24"
    >
      <Reveal>
        <h2
          id="field-heading"
          className="max-w-3xl font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl"
        >
          Search 250 million works.{" "}
          <span className="text-accent">Get the ones you can cut.</span>
        </h2>
        <p className="mt-5 max-w-2xl text-lg font-medium leading-snug text-ink/70">
          Find Articles ranks every result by how well it supports your claim and evidence type,
          then confirms it opens to real full text before it reaches you.
        </p>
      </Reveal>

      <Reveal delay={120}>
        <div className="divide-t divide-b mt-12">
          <canvas ref={attach} aria-hidden className="block h-[260px] w-full sm:h-[340px]" />
        </div>
        <div className="mt-4 flex items-start justify-between gap-6">
          <p className="label-mono text-[11px] text-ink/65">the index</p>
          <p className="label-mono text-right text-[11px] text-ink/65">your ranked results</p>
        </div>
      </Reveal>
    </section>
  );
}
