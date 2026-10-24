"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, useLayoutEffect } from "react";

export type LightboxItem = { id: string; src: string | null; width: number | null; height: number | null; alt: string };

const SLIDE_MS = 4000;
const CLOSE_MS = 200;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Fullscreen image viewer (dark, whole image with object-contain — never cropped or stretched).
 * - Keyboard: Esc closes; ←/→ follow reading direction (in RTL, ← = next, → = previous).
 * - Touch: horizontal swipe, mirrored for RTL.
 * - Focus is trapped inside the dialog and returned to the opener on close.
 * - Smooth open (CSS @starting-style), fade between photos and a short fade-out on close; all of it is
 *   neutralized by prefers-reduced-motion (globals.css + the close delay is skipped).
 * - Optional slideshow (`slideshow` starts it playing; a toggle is always shown when there is >1 item).
 * - Loading shows a visible «جارِ تحميل الصورة…» status; a failed photo shows an error with «إعادة المحاولة» (a fresh
 *   request), never a blank frame. A late load/error event of a photo that is no longer shown is ignored.
 * - Only the previous and next photos are preloaded (display variant), never the whole album.
 * - If the opener is gone when the viewer closes, focus goes to `fallbackFocus()` or the page's <main>.
 */
export function Lightbox({
  items,
  index,
  onIndexChange,
  onClose,
  actions,
  status,
  label = "عارض الصور",
  footer,
  slideshow = false,
  fallbackFocus,
}: {
  /** Where focus goes on close when the opener no longer exists (e.g. the grid item of the current photo). */
  fallbackFocus?: (item: LightboxItem) => HTMLElement | null;
  /** Shown under the image (e.g. alt text + source credit). */
  footer?: ReactNode;
  items: LightboxItem[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  /** Extra controls (e.g. select toggle) for the current item. */
  actions?: ReactNode;
  /** Shown instead of the image while loading / on error. */
  status?: "loading" | "error" | "ready";
  label?: string;
  /** Start in slideshow mode (auto-advance every 4 s, loops). */
  slideshow?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const item = items[index];
  const count = items.length;
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  // Retry count per photo: a retry bumps it, which remounts the <img> with a cache-busting query (a new request).
  const [attempt, setAttempt] = useState<Record<string, number>>({});
  const currentToken = useRef("");
  const preloads = useRef(new Map<string, HTMLImageElement>());
  // Latest values for the unmount cleanup (it would otherwise see the values of its first render).
  const itemsRef = useRef(items);
  const indexRef = useRef(index);
  const fallbackFocusRef = useRef(fallbackFocus);
  useEffect(() => {
    itemsRef.current = items;
    indexRef.current = index;
    fallbackFocusRef.current = fallbackFocus;
  });
  const [playing, setPlaying] = useState(slideshow && count > 1);
  const [closing, setClosing] = useState(false);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < count) onIndexChange(next);
    },
    [index, count, onIndexChange],
  );

  const close = useCallback(() => {
    if (closing) return;
    if (reducedMotion()) return onClose();
    setClosing(true);
    window.setTimeout(onClose, CLOSE_MS);
  }, [closing, onClose]);

  const isRtl = () => (typeof document !== "undefined" ? document.dir || document.documentElement.dir : "rtl") === "rtl";

  useEffect(() => {
    openerRef.current = document.activeElement;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      const opener = openerRef.current as HTMLElement | null;
      if (opener && opener.isConnected && opener !== document.body && typeof opener.focus === "function") return opener.focus();
      // The opener is gone (re-rendered list, removed card…): a sensible place instead of <body>.
      const shown = itemsRef.current[indexRef.current];
      const target = (shown && fallbackFocusRef.current?.(shown)) || document.querySelector<HTMLElement>("main");
      if (target) {
        if (target.tagName === "MAIN" && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus();
      }
    };
  }, []);

  // Preload only the neighbours of the current photo (display variant), so arrows feel instant without fetching the
  // whole album. Kept in a ref so the requests are not garbage-collected mid-flight.
  useEffect(() => {
    for (const n of [items[index + 1], items[index - 1]]) {
      if (!n?.src || preloads.current.has(n.id)) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = n.src;
      preloads.current.set(n.id, img);
    }
  }, [index, items]);

  // Slideshow: advance (looping) while playing; any manual navigation restarts the timer via `index`.
  useEffect(() => {
    if (!playing || count < 2) return;
    const t = window.setTimeout(() => onIndexChange(index + 1 < count ? index + 1 : 0), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [playing, index, count, onIndexChange]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const forwardKey = isRtl() ? "ArrowLeft" : "ArrowRight";
      go(e.key === forwardKey ? 1 : -1);
    } else if (e.key === "Tab") {
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes?.length) return;
      const visible = Array.from(nodes).filter((n) => n.offsetParent !== null);
      const first = visible[0] ?? nodes[0];
      const last = visible[visible.length - 1] ?? nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    // RTL: content flows right→left, so swiping right reveals the next item.
    const forward = isRtl() ? dx > 0 : dx < 0;
    go(forward ? 1 : -1);
  }

  // The photo currently shown: load/error events of any other <img> are stale and ignored.
  const token = item ? `${item.id}|${attempt[item.id] ?? 0}` : "";
  // layout effect: set before the browser can fire onLoad for a cached image (a passive effect may run later)
  useLayoutEffect(() => {
    currentToken.current = token;
  }, [token]);

  if (!item) return null;
  const tries = attempt[item.id] ?? 0;
  const src = item.src && tries ? `${item.src}${item.src.includes("?") ? "&" : "?"}r=${tries}` : item.src;
  const retry = () => {
    setFailed((s) => {
      const n = new Set(s);
      n.delete(item.id);
      return n;
    });
    setAttempt((a) => ({ ...a, [item.id]: (a[item.id] ?? 0) + 1 }));
    // The retry button is about to disappear: keep focus inside the dialog so Esc and the arrows keep working.
    closeRef.current?.focus();
  };
  const markLoaded = () => setLoaded((s) => (s.has(item.id) ? s : new Set(s).add(item.id)));
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : "3 / 2";
  const w = item.width && item.height ? item.width / item.height : 1.5;
  const navBtn =
    "absolute top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full border border-hairline bg-night/70 text-ivory transition-colors hover:border-gold hover:text-gold disabled:pointer-events-none disabled:opacity-30 md:grid";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onKeyDown={onKeyDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      data-state={closing ? "closing" : "open"}
      className={`fixed inset-0 z-[100] flex flex-col bg-night-deep/97 text-ivory transition-opacity duration-200 ease-out starting:opacity-0 ${
        closing ? "opacity-0" : "opacity-100"
      }`}
      data-testid="lightbox"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-6">
        <p className="text-sm tabular-nums text-ivory-muted" aria-live="polite">
          {index + 1} من {count}
        </p>
        <div className="flex items-center gap-2 sm:gap-3">
          {actions}
          {count > 1 ? (
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-pressed={playing}
              data-lightbox-slideshow
              className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-hairline px-4 text-sm transition-colors hover:border-gold hover:text-gold"
            >
              {playing ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" />
                </svg>
              )}
              <span>{playing ? "إيقاف العرض" : "عرض الشرائح"}</span>
            </button>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            className="min-h-11 rounded-sm border border-hairline px-4 transition-colors hover:border-gold hover:text-gold"
          >
            إغلاق
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 md:px-20">
        <div
          className="relative max-h-full w-full"
          style={{ aspectRatio: ratio, maxWidth: `min(100%, calc((100dvh - 9rem) * ${w.toFixed(4)}))` }}
        >
          {status === "error" || failed.has(item.id) || (!item.src && status !== "loading") ? (
            <div role="alert" data-lightbox-error className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-sm bg-surface p-4 text-center text-ivory-muted">
              <p>تعذّر عرض هذه الصورة الآن.</p>
              {item.src ? (
                <button
                  type="button"
                  onClick={retry}
                  data-lightbox-retry
                  className="min-h-11 rounded-sm border border-gold px-5 text-ivory transition-colors hover:bg-gold hover:text-ink focus-visible:bg-gold focus-visible:text-ink"
                >
                  إعادة المحاولة
                </button>
              ) : null}
            </div>
          ) : src ? (
            <>
              {!loaded.has(item.id) ? (
                <div role="status" data-lightbox-loading className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-sm bg-surface text-sm text-ivory-muted">
                  <span aria-hidden="true" className="size-8 animate-spin rounded-full border-2 border-hairline border-t-gold motion-reduce:animate-none" />
                  <span>جارِ تحميل الصورة…</span>
                </div>
              ) : null}
              {/* Gated short-lived display variant (never the original): plain <img>, whole image (contain). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={token}
                src={src}
                alt={item.alt}
                decoding="async"
                data-lightbox-image={item.id}
                ref={(el) => {
                  // Already in the browser cache (or finished before hydration): no load event will come.
                  if (el?.complete && el.naturalWidth > 0) markLoaded();
                }}
                onLoad={() => {
                  if (token === currentToken.current) markLoaded(); // ignore a photo we already navigated away from
                }}
                onError={() => {
                  if (token === currentToken.current) setFailed((s) => new Set(s).add(item.id));
                }}
                className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${loaded.has(item.id) ? "opacity-100" : "opacity-0"}`}
              />
            </>
          ) : (
            <div role="status" className="absolute inset-0 animate-pulse rounded-sm bg-surface" aria-label="جارِ التحميل" />
          )}
        </div>

        <button type="button" onClick={() => go(-1)} disabled={index === 0} className={`${navBtn} start-3`} aria-label="الصورة السابقة">
          <span aria-hidden="true">→</span>
        </button>
        <button type="button" onClick={() => go(1)} disabled={index >= count - 1} className={`${navBtn} end-3`} aria-label="الصورة التالية">
          <span aria-hidden="true">←</span>
        </button>
      </div>
      {footer ? <div className="px-4 pb-4 text-center text-sm text-ivory-muted md:px-6">{footer}</div> : null}
    </div>
  );
}
