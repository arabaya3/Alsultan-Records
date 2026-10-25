"use client";

import { useEffect, type RefObject } from "react";
import { useStudioState } from "./StudioProvider";

/**
 * Phones / tall screens with the scene: the visitor walks through a list (album cards, reception prints) by
 * scrolling; the item crossing the middle of the screen is "in focus" and `onFocus(index)` turns the camera to its
 * print. Pure observation — scrolling is never captured, prevented or snapped.
 */
export function useScrollFocus(list: RefObject<HTMLElement | null>, onFocus: (index: number | null) => void) {
  const st = useStudioState();
  const on = st.mode === "scene" && !st.wide;
  useEffect(() => {
    const root = list.current;
    if (!on || !root) return;
    const items = [...root.children] as HTMLElement[];
    let current: number | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = items.indexOf(e.target as HTMLElement);
          if (e.isIntersecting && i !== current) {
            if (current !== null) delete items[current]?.dataset.focus;
            current = i;
            items[i].dataset.focus = "";
            onFocus(i);
          }
        }
      },
      { rootMargin: "-42% 0px -42% 0px" },
    );
    items.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      items.forEach((el) => delete el.dataset.focus);
      onFocus(null);
    };
  }, [on, list, onFocus]);
}
