"use client";

import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { gsap, MOTION_OK } from "@/components/motion/gsap";
import { isYouTubeId, youTubeEmbedUrl, youTubeWatchUrl } from "@/lib/youtube";

export type DialogVideo = {
  youtubeId: string;
  /** Original YouTube title, rendered verbatim as text. */
  title: string;
  categories?: { slug: string; title: string }[];
  /** Video page (/work/v/<id>). */
  href?: string | null;
};

const FOCUSABLE = 'a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/**
 * Accessible YouTube player modal. The iframe (privacy-enhanced embed) is created only when the
 * dialog opens, i.e. after the visitor clicked; nothing loads or plays on page load.
 */
export function YouTubeDialog({
  video,
  onClose,
  returnFocus,
}: {
  video: DialogVideo | null;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const open = Boolean(video && isYouTubeId(video.youtubeId));

  const requestCloseRef = useRef<() => void>(() => {});
  useEffect(() => {
    requestCloseRef.current = () => {
      if (closingRef.current) return;
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
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
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
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [open, returnFocus]);

  if (!open || !video) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center p-3 sm:p-6">
      <div ref={backdropRef} className="absolute inset-0 bg-black/85" onClick={requestClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-youtube-dialog
        className="relative w-full max-w-5xl rounded-md bg-night-deep p-3 text-ivory shadow-2xl sm:p-4"
      >
        <div className="mb-2 flex items-start justify-between gap-4">
          <h2 id={titleId} className="min-w-0 pt-2 text-base font-semibold break-words sm:text-lg">
            <bdi>{video.title}</bdi>
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={requestClose}
            aria-label="إغلاق الفيديو"
            className="grid size-11 shrink-0 place-items-center rounded-sm text-ivory hover:text-gold"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="relative aspect-video max-h-[75vh] w-full overflow-hidden rounded-sm bg-black">
          <iframe
            src={youTubeEmbedUrl(video.youtubeId)}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 size-full border-0"
          />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ivory-muted">
          {video.categories?.map((c) => (
            <Link
              key={c.slug}
              href={`/work?cat=${c.slug}`}
              onClick={onClose}
              data-dialog-category={c.slug}
              className="inline-flex min-h-11 items-center text-ivory underline decoration-1 underline-offset-4 hover:decoration-gold"
            >
              {c.title}
            </Link>
          ))}
          {video.href ? (
            <Link
              href={video.href}
              onClick={onClose}
              data-dialog-details
              className="inline-flex min-h-11 items-center text-ivory underline decoration-1 underline-offset-4 hover:decoration-gold"
            >
              صفحة الفيديو
            </Link>
          ) : null}
          <span className="ms-auto">الفيديو لا يعمل هنا؟</span>
          <a
            href={youTubeWatchUrl(video.youtubeId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-ivory underline decoration-1 underline-offset-4 hover:decoration-gold"
          >
            شاهد على YouTube
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}
