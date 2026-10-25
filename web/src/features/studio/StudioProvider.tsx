"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { decideTier, SOFTWARE_RENDERER, type Tier } from "./capability";
import { STUDIO_ENTRY_KEY, STUDIO_PREF_KEY } from "./config";
import type { AlbumImage, FrameImage, Rect, SceneInput, StudioEngine } from "./engine/engine";
import { stationFor, type Station } from "./stations";

/**
 * Central controller of the immersive studio (one per public layout):
 *   - the station comes from the URL only (StationWatcher), so links, refresh and Back/Forward stay truthful;
 *   - pages hand over their real data (album wall group, the open album) with <StudioPage…/>;
 *   - the engine (three.js) is imported after first paint and only when the pre-paint check chose "scene";
 *   - any failure (no WebGL, lost context, too slow) switches the page to the static studio, never to a blank;
 *   - hotspots are real HTML links: the engine reports where each frame is and the link is moved over it.
 */
export type SharedScene = { logo: string; screen: string; reception: FrameImage[]; shelf: FrameImage[] };
type PageData = { wall?: { images: FrameImage[]; dir: number }; album?: { image: AlbumImage; index: number } };
export type StudioMode = "pending" | "scene" | "static";

type Ctx = {
  mode: StudioMode;
  wide: boolean;
  station: Station | null;
  register: (key: string, el: HTMLElement | null) => void;
  hover: (key: string | null) => void;
  preview: (key: string) => void;
  setPage: (station: Station, data: PageData) => void;
  setPreference: (pref: "scene" | "static") => void;
};
const StudioContext = createContext<Ctx | null>(null);
export const useStudio = () => useContext(StudioContext);

const WIDE = "(min-width: 1024px) and (min-aspect-ratio: 1/1)";

function StationWatcher({ onStation }: { onStation: (s: Station | null) => void }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const qs = search.toString();
  useLayoutEffect(() => {
    const s = stationFor(pathname, qs);
    const d = document.documentElement;
    if (s) d.setAttribute("data-studio-station", s);
    else d.removeAttribute("data-studio-station");
    onStation(s);
  }, [pathname, qs, onStation]);
  return null;
}

function setHtmlMode(m: "scene" | "static") {
  document.documentElement.setAttribute("data-studio", m);
}

export function StudioProvider({ shared, children }: { shared: SharedScene; children: ReactNode }) {
  const [mode, setMode] = useState<StudioMode>("pending");
  const [wide, setWide] = useState(false);
  const [station, setStation] = useState<Station | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engine = useRef<StudioEngine | null>(null);
  const hotspots = useRef(new Map<string, HTMLElement>());
  const page = useRef<{ station: Station | null; data: PageData }>({ station: null, data: {} });
  const lastAlbumIndex = useRef<number | null>(null);
  const applied = useRef(false);
  const stationRef = useRef<Station | null>(null);
  const pendingApply = useRef(0);

  // ---------------------------------------------------------------- hotspot placement
  const onRects = useCallback((rects: Record<string, Rect | null>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cr = canvas.getBoundingClientRect();
    // links sit over their prints only on wide screens; phones and tablets keep them as tiles in the flow
    const wideNow = matchMedia(WIDE).matches;
    for (const [key, el] of hotspots.current) {
      const r = wideNow ? rects[key] : null;
      if (!r || !el.isConnected) {
        el.dataset.projected = "0";
        el.style.transform = "";
        continue;
      }
      const layer = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
      if (!layer) continue;
      el.dataset.projected = "1";
      el.style.setProperty("--hs-w", `${Math.round(r.w)}px`);
      el.style.setProperty("--hs-h", `${Math.round(r.h)}px`);
      // relative to the link's own place in the flow: only a transform moves it (no layout shift)
      el.style.transform = `translate3d(${Math.round(cr.left + r.x - layer.left - el.offsetLeft)}px, ${Math.round(cr.top + r.y - layer.top - el.offsetTop)}px, 0)`;
    }
  }, []);

  // ---------------------------------------------------------------- push the current state to the engine
  const apply = useCallback(() => {
    pendingApply.current = 0;
    const e = engine.current;
    const s = stationRef.current;
    if (!e || !s) return;
    const data = page.current.station === s ? page.current.data : {};
    const input: SceneInput = { station: s, logo: shared.logo, screen: shared.screen, reception: shared.reception, shelf: shared.shelf };
    if (data.wall) {
      input.wall = data.wall.images;
      input.wallDir = data.wall.dir;
    }
    if (data.album) {
      input.album = data.album.image;
      const prev = lastAlbumIndex.current;
      input.albumDir = prev === null || prev === data.album.index ? 0 : data.album.index > prev ? 1 : -1;
      lastAlbumIndex.current = data.album.index;
    } else if (s !== "album") {
      lastAlbumIndex.current = null;
    }
    let entry = false;
    if (!applied.current && s === "reception") {
      try {
        entry = !sessionStorage.getItem(STUDIO_ENTRY_KEY);
        sessionStorage.setItem(STUDIO_ENTRY_KEY, "1");
      } catch {
        entry = false;
      }
    }
    e.set(input, { instant: !applied.current && !entry, entry });
    applied.current = true;
  }, [shared]);
  const schedule = useCallback(() => {
    if (!pendingApply.current) pendingApply.current = requestAnimationFrame(apply);
  }, [apply]);

  const onStation = useCallback(
    (s: Station | null) => {
      stationRef.current = s;
      setStation(s);
      schedule();
    },
    [schedule],
  );

  // ---------------------------------------------------------------- engine lifecycle
  const fail = useCallback(() => {
    engine.current?.dispose();
    engine.current = null;
    setHtmlMode("static");
    setMode("static");
  }, []);

  useEffect(() => {
    const mq = matchMedia(WIDE);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (document.documentElement.getAttribute("data-studio") !== "scene") {
      const t = window.setTimeout(() => setMode("static"));
      return () => clearTimeout(t);
    }
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    let io: IntersectionObserver | null = null;
    const onVis = () => engine.current?.setVisible(document.visibilityState === "visible" && inView);
    let inView = true;
    const start = async () => {
      const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
      // which GPU? a throw-away context (no three.js yet) tells hardware from a software rasterizer
      let webgl = false;
      let softwareRenderer = false;
      try {
        const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
        if (gl) {
          webgl = true;
          const info = gl.getExtension("WEBGL_debug_renderer_info");
          const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
          softwareRenderer = SOFTWARE_RENDERER.test(name);
          gl.getExtension("WEBGL_lose_context")?.loseContext();
        }
      } catch {
        webgl = false;
      }
      const tier: Tier = decideTier({
        webgl,
        softwareRenderer,
        cores: n.hardwareConcurrency,
        memoryGb: n.deviceMemory,
        saveData: n.connection?.saveData,
        coarse: matchMedia("(pointer: coarse)").matches,
      });
      if (tier === "static") return fail();
      try {
        const { createStudio } = await import("./engine/engine");
        if (cancelled || !canvasRef.current) return;
        const e = createStudio(canvasRef.current, {
          tier,
          reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
          onRects,
          onFail: () => fail(),
          onTier: (t) => document.documentElement.setAttribute("data-studio-tier", t),
          onMoving: (m) => document.documentElement.toggleAttribute("data-studio-moving", m),
        });
        engine.current = e;
        // read-only stats for tests and the perf script (no control surface)
        (window as Window & { __studioStats?: () => unknown }).__studioStats = () => e.stats();
        document.documentElement.setAttribute("data-studio-tier", tier);
        const stage = stageRef.current!;
        const size = () => e.resize(stage.clientWidth, stage.clientHeight);
        size();
        ro = new ResizeObserver(size);
        ro.observe(stage);
        io = new IntersectionObserver(([en]) => {
          inView = en.isIntersecting;
          onVis();
        });
        io.observe(stage);
        document.addEventListener("visibilitychange", onVis);
        setMode("scene");
        apply();
        // the canvas fades in over the static studio once its first frame is drawn
        requestAnimationFrame(() => requestAnimationFrame(() => stage.setAttribute("data-ready", "1")));
      } catch {
        fail();
      }
    };
    // after first paint and idle time: the page's content and LCP never wait for three.js
    const idle = "requestIdleCallback" in window;
    const handle = idle ? window.requestIdleCallback(() => void start(), { timeout: 900 }) : window.setTimeout(() => void start(), 200);
    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(handle);
      else clearTimeout(handle);
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      if (pendingApply.current) cancelAnimationFrame(pendingApply.current);
      engine.current?.dispose();
      engine.current = null;
      document.documentElement.removeAttribute("data-studio-moving");
    };
  }, [apply, fail, onRects]);

  // ---------------------------------------------------------------- API for pages / hotspots
  const register = useCallback((key: string, el: HTMLElement | null) => {
    if (el) hotspots.current.set(key, el);
    else hotspots.current.delete(key);
    engine.current?.refresh(); // the next frame reports its position
  }, []);
  const hover = useCallback((key: string | null) => engine.current?.hover(key), []);
  const preview = useCallback((key: string) => engine.current?.preview(key), []);
  const setPage = useCallback(
    (s: Station, data: PageData) => {
      page.current = { station: s, data };
      schedule();
    },
    [schedule],
  );
  const setPreference = useCallback((pref: "scene" | "static") => {
    try {
      localStorage.setItem(STUDIO_PREF_KEY, pref);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    if (pref === "static") fail();
    else window.location.reload();
  }, [fail]);

  const value = useMemo<Ctx>(() => ({ mode, wide, station, register, hover, preview, setPage, setPreference }), [mode, wide, station, register, hover, preview, setPage, setPreference]);

  return (
    <StudioContext.Provider value={value}>
      {/* decorative: the content and every action are HTML below; the canvas is never focusable */}
      <div ref={stageRef} className="studio-backdrop" aria-hidden="true" data-studio-backdrop="">
        <div className="studio-static" />
        <canvas ref={canvasRef} className="studio-canvas" tabIndex={-1} data-studio-canvas="" />
        <div className="studio-shade" />
      </div>
      <Suspense fallback={null}>
        <StationWatcher onStation={onStation} />
      </Suspense>
      {children}
    </StudioContext.Provider>
  );
}

/** A real link that also drives its 3D frame: hover/focus lift the print, a plain click starts the camera toward it. */
export function useHotspot(key: string) {
  const ctx = useStudio();
  const attach = useCallback((el: HTMLElement | null) => ctx?.register(key, el), [ctx, key]);
  return {
    attach,
    "data-hotspot": key,
    onPointerEnter: () => ctx?.hover(key),
    onPointerLeave: () => ctx?.hover(null),
    onFocus: () => ctx?.hover(key),
    onBlur: () => ctx?.hover(null),
    onClickCapture: (e: React.MouseEvent) => {
      if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && ctx?.mode === "scene" && ctx.wide) ctx.preview(key);
    },
  };
}

/** Hand the current page's scene data to the controller (renders nothing). */
export function StudioPage({ station, wall, album }: { station: Station } & PageData) {
  const ctx = useStudio();
  const setPage = ctx?.setPage;
  const key = JSON.stringify({ wall, album });
  useEffect(() => {
    setPage?.(station, JSON.parse(key) as PageData);
  }, [setPage, station, key]);
  return null;
}
