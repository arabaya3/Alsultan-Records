"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Category chips: wrapped & centered from md up; on phones ONE horizontally scrollable row (design audit #3).
 * - RTL-correct: edge fades show where more chips exist (start = right, end = left), computed from rects so they
 *   work whatever the browser's RTL scrollLeft sign is.
 * - The selected chip ([aria-current=page]) is kept inside the row on load, on every selection change (client
 *   navigation, browser back/forward — observed via aria-current, no remount needed) and on resize. Only the row
 *   scrolls: the page never jumps and focus is never moved.
 * - Keyboard: chips are plain links in DOM order; focusing one scrolls it into view natively.
 * Children: the <li> items.
 */
export function ChipScroller({ children, label }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ start: false, end: false });

  useEffect(() => {
    const ul = ref.current;
    if (!ul) return;
    const update = () => {
      const box = ul.getBoundingClientRect();
      const items = ul.children;
      if (!items.length) return;
      const first = items[0].getBoundingClientRect(); // RTL: first chip sits at the right (start)
      const last = items[items.length - 1].getBoundingClientRect();
      setMore({ start: first.right > box.right + 2, end: last.left < box.left - 2 });
    };
    // Center a chip inside the row when it is (partly) hidden; rect-based, so RTL-safe. Only scrolls the row.
    const reveal = (li: Element | null | undefined, behavior: ScrollBehavior) => {
      if (!li) return;
      const box = ul.getBoundingClientRect();
      const r = li.getBoundingClientRect();
      const pad = 48; // keep clear of the edge fades
      if (r.left < box.left + pad || r.right > box.right - pad) ul.scrollBy({ left: r.left - box.left - (box.width - r.width) / 2, behavior });
    };
    const motion = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth");
    const revealActive = (behavior: ScrollBehavior) => reveal(ul.querySelector("[aria-current=page]")?.closest("li"), behavior);
    revealActive("instant");
    // The selected chip changes WITHOUT a remount (client navigation, browser back/forward): follow aria-current.
    const mo = new MutationObserver(() => {
      revealActive(motion());
      update();
    });
    mo.observe(ul, { subtree: true, attributes: true, attributeFilter: ["aria-current"], childList: true });
    const onFocus = (e: FocusEvent) => reveal((e.target as Element).closest("li"), motion());
    const onResize = () => {
      revealActive("instant"); // phone ↔ desktop: the row may have been wrapped/unscrolled meanwhile
      update();
    };
    update();
    ul.addEventListener("scroll", update, { passive: true });
    ul.addEventListener("focusin", onFocus);
    window.addEventListener("resize", onResize);
    return () => {
      mo.disconnect();
      ul.removeEventListener("scroll", update);
      ul.removeEventListener("focusin", onFocus);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <ul
      ref={ref}
      aria-label={label}
      data-chip-scroller
      data-more-start={more.start || undefined}
      data-more-end={more.end || undefined}
      className="chip-scroller flex gap-2 max-md:-mx-[var(--gutter)] max-md:snap-x max-md:overflow-x-auto max-md:px-[var(--gutter)] max-md:py-1 md:flex-wrap md:justify-center [&>li]:shrink-0 [&>li]:snap-start"
    >
      {children}
    </ul>
  );
}
