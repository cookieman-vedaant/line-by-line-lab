"use client";

import Link from "next/link";
import { type ReactNode, useCallback } from "react";

/**
 * Cursor-reactive hero pieces.
 *
 * KineticHeading stacks an accent-colored copy of the headline over the ink one
 * and masks it to a soft circle that tracks the pointer, so the ink bleeds to
 * accent under the cursor. Two layers and one CSS variable rather than a span
 * per letter, so there is no per-character DOM and nothing to lay out per frame.
 *
 * MagneticLink pulls toward the pointer as it approaches and springs back on
 * leave.
 *
 * Both require a real pointing device and no reduced-motion preference: on touch
 * and for anyone who asked for less motion they render as ordinary markup and
 * attach no listeners at all. Neither reads layout inside the move handler (the
 * rect is measured on enter), and both write only transform or a mask position,
 * so the work per frame stays off the layout path.
 */

/** True when this device has a fine pointer and the visitor allows motion. */
function interactive(): boolean {
  return (
    window.matchMedia?.("(pointer: fine)").matches === true &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === false
  );
}

export function KineticInk({
  wrapperClassName,
  children,
}: {
  /** Layout for the pair (margins, entrance animation). The clone is inset-0,
      so any margin belongs out here or it shifts out of register. */
  wrapperClassName?: string;
  children: ReactNode;
}) {
  const attach = useCallback((host: HTMLDivElement | null) => {
    if (!host || !interactive()) return;

    let raf = 0;
    let x = 0;
    let y = 0;

    const paint = () => {
      raf = 0;
      host.style.setProperty("--mx", `${x}px`);
      host.style.setProperty("--my", `${y}px`);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const onMove = (e: PointerEvent) => {
      // offsetX/Y are already relative to the host, so no rect read per move.
      x = e.offsetX;
      y = e.offsetY;
      schedule();
    };
    const onEnter = () => host.setAttribute("data-live", "1");
    const onLeave = () => {
      host.removeAttribute("data-live");
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointerleave", onLeave);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={attach} className={`kinetic ${wrapperClassName ?? ""}`}>
      {children}
      {/* The same subtree again, so the clone lays out identically and registers
          exactly on top of the real copy. Hidden from assistive tech and from
          the pointer: it is the same words a second time. */}
      <div aria-hidden className="kinetic-glow">
        {children}
      </div>
    </div>
  );
}

export function MagneticLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  const attach = useCallback((host: HTMLSpanElement | null) => {
    if (!host || !interactive()) return;
    const target = host.firstElementChild as HTMLElement | null;
    if (!target) return;

    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let radius = 1;

    const paint = () => {
      raf = 0;
      target.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const measure = () => {
      const r = target.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      radius = Math.max(r.width, r.height) * 0.75 + 80;
    };

    const onEnter = () => {
      measure();
      target.style.transition = "none";
    };

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const pull = Math.max(0, 1 - Math.hypot(dx, dy) / radius);
      tx = dx * pull * 0.32;
      ty = dy * pull * 0.32;
      schedule();
    };

    const onLeave = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      // Decelerate back to rest. Exponential ease-out rather than an elastic
      // overshoot: nothing here has momentum, the pointer just left, and at this
      // displacement an overshoot is a couple of pixels nobody reads as spring.
      target.style.transition = "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)";
      target.style.transform = "translate3d(0, 0, 0)";
    };

    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      target.style.transform = "";
      target.style.transition = "";
    };
  }, []);

  // The negative margin gives the pull a halo to start in without changing
  // layout, and keeps the move listener scoped to that area.
  return (
    <span ref={attach} className="magnetic -m-5 inline-block p-5">
      <Link href={href} className={className}>
        {children}
      </Link>
    </span>
  );
}
