"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Lightbox, type LightboxItem } from "./Lightbox";

export type AlbumGalleryPhoto = { id: string; thumb: string; display: string; width: number | null; height: number | null; alt: string };

function Thumb({ p, index, onOpen }: { p: AlbumGalleryPhoto; index: number; onOpen: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const imgRef = useRef<HTMLImageElement>(null);
  // An image decoded before hydration never fires onLoad: settle from the element itself.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete) setState(img.naturalWidth > 0 ? "ready" : "error");
  }, []);
  // The tile keeps the photo's own aspect ratio (portrait stays portrait, landscape stays landscape).
  const ratio = p.width && p.height ? `${p.width} / ${p.height}` : "4 / 3";
  return (
    <button
      type="button"
      // Safari does not focus a button on click: focus it first, so the viewer returns focus here when it closes
      onClick={(e) => {
        e.currentTarget.focus();
        onOpen();
      }}
      aria-haspopup="dialog"
      aria-label={`عرض الصورة ${index + 1}${p.alt ? `: ${p.alt}` : ""}`}
      data-album-photo={p.id}
      className="group relative block w-full overflow-hidden rounded-lg border border-hairline-gold bg-night-deep transition-[border-color,box-shadow] duration-300 hover:border-gold hover:shadow-[0_10px_30px_-14px_rgb(233_185_73/0.5)]"
      style={{ aspectRatio: ratio }}
    >
      {state === "error" ? (
        <span data-photo-error className="absolute inset-0 grid place-items-center p-2 text-center text-sm text-ivory-muted">
          تعذّر تحميل الصورة
        </span>
      ) : (
        // Gated same-origin bytes (/p route): plain <img>, lazy, whole image (contain, never cropped), fades in.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={p.thumb}
          alt=""
          width={p.width ?? undefined}
          height={p.height ?? undefined}
          loading={index < 6 ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setState("ready")}
          onError={() => setState("error")}
          className={`absolute inset-0 size-full object-contain transition-opacity duration-500 motion-reduce:transition-none ${
            state === "ready" ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {state === "loading" ? <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-surface" /> : null}
      {/* Expand hint (decorative) */}
      <span
        aria-hidden="true"
        className="absolute end-2 top-2 grid size-8 place-items-center rounded-sm bg-black/55 text-ivory opacity-80 transition-opacity group-hover:opacity-100"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
        </svg>
      </span>
    </button>
  );
}

const actionCls =
  "inline-flex min-h-11 items-center gap-2 rounded-sm border px-5 text-base font-medium transition-colors";

function ShareButton({ title }: { title: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  async function share() {
    const url = window.location.href.split("?")[0];
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMsg("تم نسخ رابط الألبوم");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setMsg("تعذّر النسخ، انسخ الرابط من شريط العنوان");
    }
    window.setTimeout(() => setMsg(null), 3000);
  }
  return (
    <>
      <button type="button" onClick={share} data-album-share className={`${actionCls} border-ivory/40 text-ivory hover:border-gold hover:text-gold`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
        مشاركة
      </button>
      <span role="status" className="text-sm text-ivory-muted">
        {msg}
      </span>
    </>
  );
}

const SLIDESHOW_EVENT = "album:slideshow";

/**
 * Album actions (back, slideshow, share). Rendered by AlbumGallery itself by default, or placed elsewhere (the public
 * album page puts it inside the hero so the photos start higher) — it then opens the gallery's slideshow through a
 * window event, so both stay server-rendered with no layout shift.
 */
export function AlbumActions({ backHref, title, canSlideshow, onSlideshow, className = "" }: { backHref?: string; title: string; canSlideshow: boolean; onSlideshow?: () => void; className?: string }) {
  return (
    <div data-album-actions className={`flex flex-wrap items-center justify-center gap-3 ${className}`}>
      {backHref ? (
        <Link href={backHref} title="العودة للألبومات" className={`${actionCls} max-sm:px-3 border-ivory/40 text-ivory hover:border-gold hover:text-gold`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            {/* Points to the reading-start side (right in RTL) */}
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          {/* Phones: icon only (the breadcrumb right above offers the same link) so all actions fit one row. */}
          <span className="max-sm:sr-only">العودة للألبومات</span>
        </Link>
      ) : null}
      {canSlideshow ? (
        <button
          type="button"
          aria-haspopup="dialog"
          data-album-slideshow
          onClick={() => (onSlideshow ? onSlideshow() : window.dispatchEvent(new Event(SLIDESHOW_EVENT)))}
          className={`${actionCls} border-gold/70 text-gold hover:bg-gold hover:text-ink`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" />
          </svg>
          عرض الشرائح
        </button>
      ) : null}
      <ShareButton title={title} />
    </div>
  );
}

/**
 * Album view: actions (back, slideshow, share — unless `actions={false}`, when <AlbumActions> is rendered elsewhere),
 * a masonry grid (CSS columns) where every tile keeps the photo's own ratio and shows it whole (contain; watermark
 * visible), and a fullscreen lightbox (display variant only) with source credit and an optional slideshow.
 * Props: photos, albumTitle, sourceLabel, sourceUrl, backHref? (shows «العودة للألبومات» when set), actions?.
 */
export function AlbumGallery({
  photos,
  albumTitle,
  sourceLabel,
  sourceUrl,
  backHref,
  actions = true,
}: {
  photos: AlbumGalleryPhoto[];
  albumTitle: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
  backHref?: string;
  actions?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [slideshow, setSlideshow] = useState(false);
  const startSlideshow = () => {
    setSlideshow(true);
    setOpen(0);
  };
  useEffect(() => {
    if (actions) return;
    const on = () => startSlideshow();
    window.addEventListener(SLIDESHOW_EVENT, on);
    return () => window.removeEventListener(SLIDESHOW_EVENT, on);
  }, [actions]);
  const items: LightboxItem[] = photos.map((p) => ({ id: p.id, src: p.display, width: p.width, height: p.height, alt: p.alt || albumTitle }));
  const current = open !== null ? photos[open] : null;
  const credit = sourceLabel ? (
    <span data-lightbox-credit>
      المصدر:{" "}
      {sourceUrl ? (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-ivory underline underline-offset-4 hover:decoration-gold">
          {sourceLabel}
        </a>
      ) : (
        sourceLabel
      )}
    </span>
  ) : null;
  return (
    <>
      {actions ? <AlbumActions backHref={backHref} title={albumTitle} canSlideshow={photos.length > 1} onSlideshow={startSlideshow} className="mb-8" /> : null}

      <ul data-photo-grid className="columns-2 gap-2 sm:columns-3 sm:gap-4 lg:columns-4">
        {photos.map((p, i) => (
          <li key={p.id} className="mb-2 break-inside-avoid sm:mb-4">
            <Thumb
              p={p}
              index={i}
              onOpen={() => {
                setSlideshow(false);
                setOpen(i);
              }}
            />
          </li>
        ))}
      </ul>
      {open !== null && current ? (
        <Lightbox
          items={items}
          index={open}
          onIndexChange={setOpen}
          fallbackFocus={(it) => document.querySelector<HTMLElement>(`[data-album-photo="${CSS.escape(it.id)}"]`)}
          onClose={() => setOpen(null)}
          slideshow={slideshow}
          label={`صور: ${albumTitle}`}
          footer={
            <div className="flex flex-col items-center gap-1">
              {current.alt ? <p data-lightbox-alt className="text-ivory/90">{current.alt}</p> : null}
              {credit}
            </div>
          }
        />
      ) : null}
    </>
  );
}
