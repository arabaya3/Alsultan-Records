"use client";

import { useEffect, useRef, type ReactNode } from "react";
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
  }, [onScroll], { scroll: onScroll });
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

/**
 * FadeRise — subtle fade + 16px rise, once, when the element enters the viewport.
 * Progressive: the server HTML is fully visible. On the client, only elements still below the fold get
 * `.reveal-pending` (CSS, motion-allowed only), so nothing in view ever blinks and nothing stays hidden if JS
 * fails. opacity/transform only → no layout shift. Disabled under prefers-reduced-motion (CSS + JS check).
 *   as?: "div" | "section" | "li" | "article" (default "div") · delay?: ms (stagger siblings, e.g. i*80)
 *   className?, plus data-* via `data`.
 */
export function FadeRise({
  children,
  as: Tag = "div",
  delay = 0,
  className = "",
  data,
}: {
  children: ReactNode;
  as?: "div" | "section" | "li" | "article";
  delay?: number;
  className?: string;
  data?: Record<`data-${string}`, string | boolean | undefined>;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return; // already in view: leave as is
    el.classList.add("reveal-pending");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          if (delay) el.style.transitionDelay = `${delay}ms`;
          el.classList.add("reveal-in");
          el.classList.remove("reveal-pending");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      el.classList.remove("reveal-pending");
    };
  }, [delay]);
  return (
    <Tag ref={ref as never} className={className} {...data}>
      {children}
    </Tag>
  );
}
