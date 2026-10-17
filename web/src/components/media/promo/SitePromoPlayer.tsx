"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { gsap, MOTION_OK } from "@/components/motion/gsap";
import { PlayBadge } from "@/components/ui/Button";
import { PROMO_ASSETS, type PromoAsset } from "./promo-assets";

/** Phones / portrait screens get the 9:16 cut; must match the CSS `md` breakpoint used for the cover. */
const PORTRAIT_QUERY = "(max-width: 767px), (orientation: portrait)";
const COVER_PORTRAIT_MEDIA = "(max-width: 767px)";
const FOCUSABLE = 'a[href], button:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

export const PROMO_TITLE = "فيديو تعريفي بستوديو وتسجيلات السلطان";

type Variant = "landscape" | "portrait";

/**
 * Self-hosted studio promo (static files in /public/promo, content-hashed, served by the CDN).
 * The card shows the cover only; the <video> (preload="none") is created when the visitor opens
 * the dialog, with ONE source chosen for the viewport at that moment. Nothing loads or plays on page load.
 */
export function SitePromoPlayer({
  label = "شاهد البرومو",
  caption,
  priority = false,
  sizes = "(min-width: 1024px) 45vw, 100vw",
}: {
  label?: string;
  caption: string;
  priority?: boolean;
  sizes?: string;
}) {
  const [variant, setVariant] = useState<Variant | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { landscape: L, portrait: P } = PROMO_ASSETS;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setVariant(window.matchMedia(PORTRAIT_QUERY).matches ? "portrait" : "landscape")}
        aria-haspopup="dialog"
        data-promo-trigger
        className="group relative block aspect-[4/5] w-full overflow-hidden rounded-md bg-black text-start ring-1 ring-ink-line md:aspect-video"
      >
        <picture>
          <source media={COVER_PORTRAIT_MEDIA} type="image/webp" srcSet={P.coverWebp} />
          <source media={COVER_PORTRAIT_MEDIA} type="image/jpeg" srcSet={P.coverJpg} />
          <source type="image/webp" srcSet={L.coverWebp} />
          <img
            src={L.coverJpg}
            alt=""
            width={L.width}
            height={L.height}
            sizes={sizes}
            data-promo-cover
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        </picture>
        <span aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-black/85 via-black/15 to-transparent" />
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-4 p-4 sm:p-5">
          <PlayBadge size={56} className="bg-black/40 text-gold transition-colors duration-200 group-hover:bg-gold group-hover:text-ink" />
          <span className="min-w-0">
            <span className="block font-display text-lg font-semibold text-on-dark sm:text-xl">{label}</span>
            <span className="block truncate text-sm text-on-dark/85">{caption}</span>
            <span className="sr-only"> — {PROMO_TITLE}</span>
          </span>
        </span>
      </button>
      <PromoDialog variant={variant} onClose={() => setVariant(null)} returnFocus={triggerRef} />
    </>
  );
}

function PromoDialog({
  variant,
  onClose,
  returnFocus,
}: {
  variant: Variant | null;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const closingRef = useRef(false);
  const open = variant !== null;
  const asset: PromoAsset | null = variant ? PROMO_ASSETS[variant] : null;

  const stop = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try {
      v.currentTime = 0;
    } catch {}
  };

  const requestCloseRef = useRef<() => void>(() => {});
  useEffect(() => {
    requestCloseRef.current = () => {
      if (closingRef.current) return;
      stop();
      const panel = panelRef.current;
      if (!panel || !window.matchMedia(MOTION_OK).matches) {
        onClose();
        return;
      }
      closingRef.current = true;
      gsap.to(backdropRef.current, { opacity: 0, duration: 0.2, ease: "power2.in" });
      gsap.to(panel, {
        opacity: 0,
        scale: 0.97,
        duration: 0.2,
        ease: "power2.in",
        onComplete: () => {
          closingRef.current = false;
          onClose();
        },
      });
    };
  });
  const requestClose = () => requestCloseRef.current();

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel && window.matchMedia(MOTION_OK).matches) {
      gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "power2.out" });
      gsap.fromTo(
        panel,
        { opacity: 0, scale: 0.96, y: 12 },
        { opacity: 1, scale: 1, y: 0, duration: 0.35, ease: "power3.out", clearProps: "transform,opacity" },
      );
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trigger = returnFocus.current;
    const video = videoRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    // Opened by a click (transient user activation) → playing with sound is allowed. If the browser
    // still refuses, the native controls are visible and the poster stays up.
    video?.play().catch(() => {});
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        requestCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = panelRef.current?.contains(active) ?? false;
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      video?.pause();
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [open, returnFocus]);

  if (!open || !asset) return null;
  const portrait = variant === "portrait";
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center p-3 sm:p-6">
      <div ref={backdropRef} className="absolute inset-0 bg-black/85" onClick={requestClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-promo-dialog={variant}
        className={`relative rounded-md bg-ink p-3 text-on-dark shadow-2xl sm:p-4 ${portrait ? "w-auto max-w-full" : "w-full max-w-5xl"}`}
      >
        <div className="mb-2 flex items-start justify-between gap-4">
          <h2 id={titleId} className="min-w-0 pt-2 text-base font-semibold break-words sm:text-lg">
            {PROMO_TITLE}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={requestClose}
            aria-label="إغلاق الفيديو"
            className="grid size-11 shrink-0 place-items-center rounded-sm text-on-dark hover:text-gold"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <video
          ref={videoRef}
          key={asset.video}
          src={asset.video}
          poster={asset.coverJpg}
          controls
          playsInline
          preload="none"
          width={asset.width}
          height={asset.height}
          aria-label={PROMO_TITLE}
          title={PROMO_TITLE}
          data-promo-video={variant}
          className="mx-auto block rounded-sm bg-black"
          style={
            portrait
              ? { aspectRatio: "9 / 16", width: "auto", height: "min(calc(100dvh - 7rem), calc((100vw - 3rem) * 16 / 9))", maxWidth: "100%" }
              : { aspectRatio: "16 / 9", height: "auto", width: "min(100%, calc((100dvh - 8rem) * 16 / 9))" }
          }
        />
      </div>
    </div>,
    document.body,
  );
}
