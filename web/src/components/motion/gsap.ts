"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLayoutEffect, type RefObject } from "react";

let scrollUsers = 0;

/** Registers ScrollTrigger only when a scroll effect mounts with motion allowed. */
function acquireScroll() {
  if (scrollUsers++ === 0) gsap.registerPlugin(ScrollTrigger);
}
function releaseScroll() {
  scrollUsers = Math.max(0, scrollUsers - 1);
  if (scrollUsers === 0) ScrollTrigger.getAll().forEach((t) => t.kill());
}

export { gsap };

export const MOTION_OK = "(prefers-reduced-motion: no-preference)";

/** True when the visitor asked to save data (no autoplaying video then). */
export function prefersSaveData(): boolean {
  if (typeof navigator === "undefined") return false;
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(c?.saveData);
}

/**
 * Runs a GSAP setup scoped to `scope`, only when reduced motion is NOT requested.
 * Everything is reverted on unmount (gsap.context().revert()), so content is always
 * left in its natural, fully visible state.
 */
export function useMotion(
  scope: RefObject<HTMLElement | null>,
  setup: (el: HTMLElement) => void,
  deps: unknown[] = [],
  opts: { scroll?: boolean } = {},
) {
  useLayoutEffect(() => {
    const el = scope.current;
    if (!el) return;
    let used = false;
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        if (opts.scroll) {
          acquireScroll();
          used = true;
        }
        setup(el);
      });
    }, el);
    return () => {
      ctx.revert();
      if (used) releaseScroll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
