"use client";

import { type ReactNode, useCallback, useState } from "react";

/**
 * Scroll-triggered entrance: content rises, fades, and de-blurs into place the
 * first time it enters the viewport. One consistent motion across the page (it
 * echoes the app's existing cut-in keyframe) rather than a different effect per
 * section. Uses a callback ref (not an effect) so it stays SSR-safe and sets up
 * the observer exactly when the node mounts. Honors prefers-reduced-motion and
 * shows instantly where IntersectionObserver is unavailable.
 */
export default function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(false);

  const attach = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect(); // React 19 ref cleanup
  }, []);

  const ease = "cubic-bezier(.2,.9,.3,1)";
  return (
    <div
      ref={attach}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(20px)",
        filter: shown ? "none" : "blur(7px)",
        transition: `opacity .7s ${ease} ${delay}ms, transform .7s ${ease} ${delay}ms, filter .7s ${ease} ${delay}ms`,
        willChange: "opacity, transform, filter",
      }}
    >
      {children}
    </div>
  );
}
