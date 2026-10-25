"use client";

import { useEffect } from "react";

/**
 * Touch swipe between neighbouring albums on the album's opening screen (the book + title area). It only follows
 * a clearly horizontal drag, never one that starts at a screen edge (the browser's back/forward gestures live
 * there), and it never prevents vertical scrolling. It "clicks" the existing «الألبوم السابق / التالي» link, so the
 * navigation, history entry and scene move are exactly the same as with the buttons.
 * RTL: dragging to the right brings the next album (content moves right, the next comes in from the left).
 */
export function AlbumSwipe({ scope = "[data-album-page] .hero-flow" }: { scope?: string }) {
  useEffect(() => {
    const area = document.querySelector<HTMLElement>(scope);
    if (!area) return;
    const EDGE = 28;
    let sx = 0;
    let sy = 0;
    let id: number | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || e.clientX < EDGE || e.clientX > innerWidth - EDGE) return;
      if ((e.target as HTMLElement).closest("a, button, input, [role=dialog]")) return;
      id = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
      document.querySelector<HTMLAnchorElement>(dx > 0 ? "[data-album-next]" : "[data-album-prev]")?.click();
    };
    const cancel = () => (id = null);
    area.addEventListener("pointerdown", down, { passive: true });
    area.addEventListener("pointerup", up, { passive: true });
    area.addEventListener("pointercancel", cancel, { passive: true });
    return () => {
      area.removeEventListener("pointerdown", down);
      area.removeEventListener("pointerup", up);
      area.removeEventListener("pointercancel", cancel);
    };
  }, [scope]);
  return null;
}
