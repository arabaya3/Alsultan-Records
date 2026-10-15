"use client";

import { useRef, type ReactNode } from "react";
import { gsap, useMotion } from "./gsap";

/** Clip-path mask reveal for showcase tiles, once, when scrolled into view. */
export function MaskReveal({
  children,
  className = "",
  index = 0,
}: {
  children: ReactNode;
  className?: string;
  index?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(ref, (el) => {
    gsap.fromTo(
      el,
      { clipPath: "inset(0 0 100% 0)" },
      {
        clipPath: "inset(0 0 0% 0)",
        duration: 0.9,
        ease: "power3.out",
        delay: index * 0.12,
        clearProps: "clipPath",
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
      },
    );
  }, [], { scroll: true });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** Subtle vertical parallax for the hero image. Scrubbed to scroll; no hijacking. */
export function Parallax({
  children,
  className = "",
  amount = 8,
}: {
  children: ReactNode;
  className?: string;
  amount?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(ref, (el) => {
    gsap.fromTo(
      el,
      { yPercent: 0 },
      {
        yPercent: amount,
        ease: "none",
        scrollTrigger: { trigger: el.parentElement ?? el, start: "top top", end: "bottom top", scrub: true },
      },
    );
  }, [], { scroll: true });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
