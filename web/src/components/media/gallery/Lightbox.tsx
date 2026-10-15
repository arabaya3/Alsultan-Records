"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";

export type LightboxItem = { id: string; src: string | null; width: number | null; height: number | null; alt: string };

/**
 * Fullscreen image viewer.
 * - Keyboard: Esc closes; ←/→ follow reading direction (in RTL, ← = next, → = previous).
 * - Touch: horizontal swipe, mirrored for RTL.
 * - Focus is trapped inside the dialog and returned to the opener on close.
 * - Transitions are CSS-only and neutralized by prefers-reduced-motion (globals.css).
 */
export function Lightbox({
  items,
  index,
  onIndexChange,
  onClose,
  actions,
  status,
  label = "عارض الصور",
}: {
  items: LightboxItem[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  /** Extra controls (e.g. select toggle) for the current item. */
  actions?: ReactNode;
  /** Shown instead of the image while loading / on error. */
  status?: "loading" | "error" | "ready";
  label?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const item = items[index];
  const count = items.length;

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < count) onIndexChange(next);
    },
    [index, count, onIndexChange],
  );

  const isRtl = () => (typeof document !== "undefined" ? document.dir || document.documentElement.dir : "rtl") === "rtl";

  useEffect(() => {
    openerRef.current = document.activeElement;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      const opener = openerRef.current as HTMLElement | null;
      if (opener && typeof opener.focus === "function") opener.focus();
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const forwardKey = isRtl() ? "ArrowLeft" : "ArrowRight";
      go(e.key === forwardKey ? 1 : -1);
    } else if (e.key === "Tab") {
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes?.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
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

  if (!item) return null;
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : "3 / 2";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onKeyDown={onKeyDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="fixed inset-0 z-[100] flex flex-col bg-ink/97 text-on-dark"
      data-testid="lightbox"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-6">
        <p className="text-sm text-muted" aria-live="polite">
          {index + 1} من {count}
        </p>
        <div className="flex items-center gap-3">
          {actions}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-sm border border-ink-line px-4 hover:border-gold"
          >
            إغلاق
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 md:px-20">
        <div className="relative max-h-full w-full max-w-[min(100%,calc((100dvh-9rem)*1.5))]" style={{ aspectRatio: ratio }}>
          {status === "error" || (!item.src && status !== "loading") ? (
            <div className="absolute inset-0 grid place-items-center rounded-sm bg-ink-2 text-center text-muted">
              <p>تعذّر عرض هذه الصورة الآن.</p>
            </div>
          ) : item.src ? (
            // Signed, short-lived URL: plain <img> (next/image would cache it under a fixed key).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={item.id}
              src={item.src}
              alt={item.alt}
              className="absolute inset-0 h-full w-full object-contain transition-opacity duration-300"
            />
          ) : (
            <div className="absolute inset-0 animate-pulse rounded-sm bg-ink-2" aria-label="جارِ التحميل" />
          )}
        </div>

        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          className="absolute start-2 top-1/2 hidden min-h-11 -translate-y-1/2 rounded-sm bg-ink/70 px-4 disabled:opacity-30 md:block"
          aria-label="الصورة السابقة"
        >
          <span aria-hidden="true">→</span>
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index >= count - 1}
          className="absolute end-2 top-1/2 hidden min-h-11 -translate-y-1/2 rounded-sm bg-ink/70 px-4 disabled:opacity-30 md:block"
          aria-label="الصورة التالية"
        >
          <span aria-hidden="true">←</span>
        </button>
      </div>
    </div>
  );
}
