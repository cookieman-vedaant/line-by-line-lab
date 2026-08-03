"use client";

import { useCallback } from "react";

/**
 * A scan sweeping across a field of dots behind the hero.
 *
 * It echoes the page's own dot background and the Source Field further down, so
 * the hero reads as the same instrument rather than a separate effect. Dots the
 * band passes over light to the accent and swell, then fall back to ink.
 *
 * Cost is deliberately bounded: one canvas, one rAF, fillRect only. No layout is
 * read in the loop, it stops when scrolled out of view or the tab is hidden, and
 * it renders a single static frame when motion is reduced. It sits behind the
 * hero text at low opacity and never takes pointer events.
 */

const PERIOD = 6400;
const CELL = 26; // dot pitch, matching the page's own dot texture
const BAND = 190; // how wide the lit band is, in px

export default function HeroScanner() {
  const attach = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let cols = 0;
    let rows = 0;
    let ink = "#17130f";
    let accent = "#2f43ff";

    const readColors = () => {
      const cs = getComputedStyle(document.documentElement);
      ink = cs.getPropertyValue("--ink").trim() || ink;
      accent = cs.getPropertyValue("--accent").trim() || accent;
    };

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(rect.width));
      H = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(W / CELL) + 1;
      rows = Math.ceil(H / CELL) + 1;
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      // The band travels a little past both edges so it never pops in or out.
      const scanX = ((t % PERIOD) / PERIOD) * (W + BAND * 2) - BAND;

      for (let c = 0; c < cols; c += 1) {
        const x = c * CELL;
        // Distance falloff is per column, so it is computed once per column
        // rather than once per dot.
        const lit = Math.max(0, 1 - Math.abs(x - scanX) / (BAND / 2));
        if (lit > 0.02) {
          ctx.fillStyle = accent;
          ctx.globalAlpha = 0.14 + lit * 0.5;
        } else {
          ctx.fillStyle = ink;
          ctx.globalAlpha = 0.11;
        }
        const r = 1.5 + lit * 1.9;
        for (let rw = 0; rw < rows; rw += 1) {
          ctx.fillRect(x - r / 2, rw * CELL - r / 2, r, r);
        }
      }
      ctx.globalAlpha = 1;
    };

    readColors();
    measure();

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      draw(0);
      const ro = new ResizeObserver(() => {
        measure();
        draw(0);
      });
      ro.observe(canvas);
      return () => ro.disconnect();
    }

    let raf = 0;
    let t0 = performance.now();
    let clock = 0;
    let running = false;

    const frame = (now: number) => {
      clock = now - t0;
      draw(clock);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running) return;
      running = true;
      t0 = performance.now() - clock;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };

    let onScreen = true;
    const sync = () => (onScreen && !document.hidden ? start() : stop());

    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      sync();
    });
    io.observe(canvas);

    const ro = new ResizeObserver(() => {
      measure();
      draw(clock);
    });
    ro.observe(canvas);

    const mo = new MutationObserver(() => {
      readColors();
      draw(clock);
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });

    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <canvas
      ref={attach}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
    />
  );
}
