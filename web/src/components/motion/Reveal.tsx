"use client";

import { useRef, type ReactNode } from "react";
import { gsap, useMotion } from "./gsap";

/**
 * Staggered entrance for whole lines/words. Children opt in with `data-reveal`.
 * Arabic is NEVER split into letters (that breaks glyph shaping) — mark whole
 * elements (a heading line, a paragraph, a CTA) with data-reveal.
 *
 * Short and non-blocking: content is interactive immediately; with reduced motion
 * nothing animates.
 */
export function Reveal({
  children,
  className = "",
  delay = 0.1,
  onScroll = false,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  /** Trigger when scrolled into view instead of on load. */
  onScroll?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(ref, (el) => {
    const targets = el.querySelectorAll("[data-reveal]");
    if (!targets.length) return;
    gsap.from(targets, {
      y: 18,
      autoAlpha: 0,
      duration: 0.55,
      ease: "power2.out",
      stagger: 0.08,
      delay,
      clearProps: "transform,opacity,visibility",
      scrollTrigger: onScroll ? { trigger: el, start: "top 85%", once: true } : undefined,
    });
  });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** Logo entrance: fade + small rise, ≤600ms, never blocks interaction. */
export function BrandEntrance({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(ref, (el) => {
    gsap.from(el, { y: 8, autoAlpha: 0, duration: 0.5, ease: "power2.out", clearProps: "all" });
  });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
