"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Album = { slug: string; title: string };
/** album/n/total are null for the owner-chosen first photo when it is not taken from a known album. */
type Slide = { id: string; album: Album | null; n: number | null; total: number | null };

/** Time each photo stays on screen. Longer than the offer strip's 6 s, so the two never change at the same moment. */
const HOLD = 7000;
const src = (id: string, v: "display" | "thumb") => `/p/${encodeURIComponent(id)}/${v}`;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Home hero photo panel. It opens on the owner's saved hero photo (admin «مصدر صورة الواجهة»: a chosen photo or the newest
 * album's cover), then plays the published albums, newest published first: every photo of the newest album
 * in album order, then the next album, then round again. The album list is read again at the start of each round, so a
 * newly published album joins the next round without cutting the current photo. Only one album's ids are held at a time
 * and only the current and the next photo are loaded. A photo that no longer loads (hidden, deleted) is skipped.
 * Cross-fade with a very slight zoom; stops while the tab is hidden and never moves under reduced motion. The first
 * photo is the one the server rendered, so the first paint is unchanged; with no album photo the hero keeps `fallback`.
 */
export function HeroSlideshow({ albums: initialAlbums, first, fallback }: { albums: Album[]; first: Slide | null; fallback: React.ReactNode }) {
  const [layers, setLayers] = useState<{ a: Slide | null; b: Slide | null; on: "a" | "b" }>({ a: first, b: null, on: "a" });
  const [running, setRunning] = useState(false);
  const state = useRef<{ albums: Album[]; ai: number; ids: string[]; pi: number }>({
    albums: initialAlbums,
    ai: 0,
    ids: [],
    pi: -1,
  });
  const loadedFirstAlbum = useRef(false);
  const shown = useRef<string | null>(first?.id ?? null);

  // Motion only when allowed and the tab is visible.
  useEffect(() => {
    if (!first || initialAlbums.length === 0) return;
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setRunning(!m.matches && document.visibilityState === "visible");
    update();
    m.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      m.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [first, initialAlbums.length]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer = 0;

    const albumIds = async (a: Album) => (await getJson<{ ids: string[] }>(`/api/hero-slides?album=${encodeURIComponent(a.slug)}`))?.ids ?? [];
    const preload = (id: string) =>
      new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = src(id, "display");
      });

    /** The slide after the current one; null when nothing can be shown. Tries a bounded number of photos. */
    const nextSlide = async (): Promise<Slide | null> => {
      const s = state.current;
      if (!loadedFirstAlbum.current && s.albums[0]) {
        // After the opening photo: the newest album from its first photo.
        s.ids = await albumIds(s.albums[0]);
        s.pi = -1;
        loadedFirstAlbum.current = true;
      }
      for (let tries = 0; tries < 12; tries++) {
        s.pi += 1;
        if (s.pi >= s.ids.length) {
          s.ai += 1;
          if (s.ai >= s.albums.length) {
            // New round: newly published albums come first, the current photo was not cut.
            const fresh = (await getJson<{ albums: Album[] }>("/api/hero-slides"))?.albums;
            if (fresh?.length) s.albums = fresh;
            s.ai = 0;
          }
          const album = s.albums[s.ai];
          if (!album) return null;
          s.ids = await albumIds(album);
          s.pi = 0;
          if (!s.ids.length) continue;
        }
        const id = s.ids[s.pi];
        if (id === shown.current) continue; // never the same photo twice in a row
        if (await preload(id)) return { id, album: s.albums[s.ai], n: s.pi + 1, total: s.ids.length };
      }
      return null;
    };

    const step = async () => {
      const next = await nextSlide();
      if (cancelled) return;
      if (next) {
        shown.current = next.id;
        setLayers((l) => (l.on === "a" ? { ...l, b: next, on: "b" } : { ...l, a: next, on: "a" }));
      }
      timer = window.setTimeout(step, HOLD);
    };
    timer = window.setTimeout(step, HOLD);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [running, first]);

  if (!first) return <>{fallback}</>;
  const current = layers.on === "a" ? layers.a : layers.b;

  const layer = (s: Slide | null, key: "a" | "b") =>
    s ? (
      <div key={key} className="hero-slide absolute inset-0" data-on={layers.on === key ? "1" : "0"} aria-hidden={layers.on === key ? undefined : true}>
        {s === first ? (
          // The small variant paints first on a slow phone; the sharp one covers it as soon as it arrives.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src(s.id, "thumb")} alt="" aria-hidden="true" fetchPriority="high" decoding="async" data-hero-photo="placeholder" className="absolute inset-0 size-full object-cover object-[50%_18%]" />
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src(s.id, "display")}
          data-hero-photo={s === first ? "sharp" : undefined}
          alt=""
          decoding="async"
          fetchPriority={s === first ? "high" : undefined}
          className="absolute inset-0 size-full object-cover object-[50%_18%]"
        />
      </div>
    ) : null;

  return (
    // One child of the photo panel: the panel's slanted clip then cuts the panel as a whole, never the album chip.
    <div data-hero-slideshow className="absolute inset-0">
      {layer(layers.a, "a")}
      {layer(layers.b, "b")}
      {current?.album ? (
        // Album name (opens the album) and progress, in the bottom corner away from the faces.
        <div data-hero-album className="absolute bottom-3 left-3 z-10 flex max-w-[70%] items-center gap-3 rounded-full bg-navy-deep px-4 text-base text-ivory lg:bottom-5 lg:left-5">
          <Link href={`/work/albums/${current.album.slug}`} className="inline-flex min-h-11 min-w-0 items-center truncate underline-offset-4 hover:text-gold hover:underline">
            <span className="truncate">{current.album.title}</span>
          </Link>
          {current.n && current.total ? (
            <span dir="ltr" className="shrink-0 text-sm text-ivory/80" aria-label={`صورة ${current.n} من ${current.total}`}>
              {current.n}/{current.total}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
