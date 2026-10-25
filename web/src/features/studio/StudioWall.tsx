"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { arNum } from "@/features/public-content/labels";
import { photoUrl } from "@/features/public-content/gallery-model";
import { wallGroup } from "./poses";
import { getStudioState, StudioPage, useStudio, useStudioState } from "./StudioProvider";
import { useScrollFocus } from "./useScrollFocus";

/**
 * The album list as the studio's photo wall.
 *   - Wide screens with the scene: the list is shown in groups of five; each visible card is moved over its
 *     hanging print (the card is the real, focusable link; its cover stays transparent over the 3D print, its
 *     title and count are drawn below). «المجموعة السابقة / التالية» pages through the list in order.
 *   - Phones, the static studio, no JS: the same list as large stacked covers — nothing hidden, nothing duplicated.
 * The group is remembered per URL for this tab (Back returns to the same group); the URL itself is unchanged.
 */
type WallAlbum = { slug: string; coverId: string | null; title: string };

export function StudioWall({ albums, children, className = "" }: { albums: WallAlbum[]; children: ReactNode; className?: string }) {
  const ctx = useStudio();
  const ul = useRef<HTMLUListElement>(null);
  const [group, setGroup] = useState(0);
  const [dir, setDir] = useState(0);
  const st = useStudioState();
  const active = Boolean(ctx && st.mode !== "static" && st.wide);
  const { start, end, groups } = wallGroup(albums.length, group);
  const storeKey = useRef("");

  useEffect(() => {
    storeKey.current = `sultan-wall:${location.pathname}${location.search}`;
    try {
      const g = Number(sessionStorage.getItem(storeKey.current) ?? "0");
      if (Number.isFinite(g) && g > 0) setGroup(g);
    } catch {
      /* no storage: start at the first group */
    }
  }, []);

  // only the current group is in the page while the wall is active; everything otherwise
  useLayoutEffect(() => {
    const list = ul.current;
    if (!list) return;
    [...list.children].forEach((li, i) => ((li as HTMLElement).hidden = active && (i < start || i >= end)));
    list.toggleAttribute("data-wall-live", active);
    if (!active) return;
    // the wall reserves the rest of the room's first screen, so the page continues right after the room
    const fit = () => {
      const backdrop = document.querySelector<HTMLElement>("[data-studio-backdrop]");
      if (!backdrop) return;
      const top = list.getBoundingClientRect().top - backdrop.getBoundingClientRect().top;
      list.style.setProperty("--wall-h", `${Math.max(320, Math.round(backdrop.offsetHeight - top))}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [active, start, end]);

  // the visible group's cards are the hotspots of the five prints
  useLayoutEffect(() => {
    if (!ctx || !ul.current) return;
    const items = [...ul.current.children] as HTMLElement[];
    const cleanups: (() => void)[] = [];
    for (let j = 0; j < 5; j++) {
      const key = `wall:${j}`;
      const li = active ? items[start + j] : undefined;
      if (!li || start + j >= end) {
        ctx.register(key, null);
        continue;
      }
      ctx.register(key, li);
      const enter = () => ctx.hover(key);
      const leave = () => ctx.hover(null);
      const click = (e: MouseEvent) => {
        if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && getStudioState().mode === "scene") ctx.preview(key);
      };
      li.addEventListener("pointerenter", enter);
      li.addEventListener("pointerleave", leave);
      li.addEventListener("focusin", enter);
      li.addEventListener("focusout", leave);
      li.addEventListener("click", click, true);
      cleanups.push(() => {
        li.removeEventListener("pointerenter", enter);
        li.removeEventListener("pointerleave", leave);
        li.removeEventListener("focusin", enter);
        li.removeEventListener("focusout", leave);
        li.removeEventListener("click", click, true);
        li.style.transform = "";
        delete li.dataset.projected;
      });
    }
    return () => {
      cleanups.forEach((f) => f());
      for (let j = 0; j < 5; j++) ctx.register(`wall:${j}`, null);
    };
  }, [ctx, active, start, end]);

  const go = useCallback(
    (to: number) => {
      const next = wallGroup(albums.length, to).group;
      setDir(next > group ? 1 : -1);
      setGroup(next);
      try {
        sessionStorage.setItem(storeKey.current, String(next));
      } catch {
        /* ignore */
      }
      // keep keyboard users on the wall: focus the first card of the new group after it is shown
      requestAnimationFrame(() => (ul.current?.children[next * 5]?.querySelector("a") as HTMLElement | null)?.focus({ preventScroll: true }));
    },
    [albums.length, group],
  );

  // phones: scrolling the list walks along the wall — the centred card's group hangs on the rope and the camera
  // turns to its print
  const onScrollFocus = useCallback(
    (i: number | null) => {
      if (i === null) return ctx?.focus(null);
      const g = Math.floor(i / 5);
      setGroup((cur) => {
        if (cur !== g) setDir(g > cur ? 1 : -1);
        return g;
      });
      ctx?.focus(`wall:${i % 5}`);
    },
    [ctx],
  );
  useScrollFocus(ul, onScrollFocus);

  const slice = albums.slice(start, end);
  const images = slice.map((a) => (a.coverId ? { key: a.slug, src: photoUrl(a.coverId, "thumb") } : null));
  const range = `${arNum(start + 1)}–${arNum(end)} من ${arNum(albums.length)}`;

  return (
    <div className="studio-wall" data-studio-wall-root="">
      <StudioPage station="albums" wall={{ images, dir }} />
      {groups > 1 ? (
        <nav aria-label="مجموعات الألبومات على الحائط" className="studio-wall__pager" data-wall-pager="">
          <button type="button" onClick={() => go(group - 1)} disabled={group === 0} data-wall-prev="" className="studio-pager-btn">
            <span aria-hidden="true">→</span> المجموعة السابقة
          </button>
          <p aria-live="polite" className="studio-wall__range" data-wall-range="">
            الألبومات {range}
          </p>
          <button type="button" onClick={() => go(group + 1)} disabled={group >= groups - 1} data-wall-next="" className="studio-pager-btn">
            المجموعة التالية <span aria-hidden="true">←</span>
          </button>
        </nav>
      ) : null}
      <ul ref={ul} data-album-grid="" data-studio-wall="" className={className}>
        {children}
      </ul>
    </div>
  );
}
