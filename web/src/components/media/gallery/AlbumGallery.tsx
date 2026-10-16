"use client";

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
  const ratio = p.width && p.height ? `${p.width} / ${p.height}` : "4 / 3";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`عرض الصورة ${index + 1}${p.alt ? `: ${p.alt}` : ""}`}
      data-album-photo={p.id}
      className="group relative block w-full overflow-hidden rounded-sm bg-cream-line"
      style={{ aspectRatio: ratio }}
    >
      {state === "error" ? (
        <span data-photo-error className="absolute inset-0 grid place-items-center p-2 text-center text-sm text-on-cream-muted">
          تعذّر تحميل الصورة
        </span>
      ) : (
        // Gated same-origin bytes (/p route): plain <img>, lazy, fades in when decoded (progressive).
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
          className={`absolute inset-0 size-full object-cover transition-[opacity,transform] duration-500 group-hover:scale-[1.02] motion-reduce:transition-none ${
            state === "ready" ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {state === "loading" ? <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-cream-line" /> : null}
    </button>
  );
}

/** Album grid (reserved aspect ratios from width/height) + fullscreen lightbox with source credit. */
export function AlbumGallery({
  photos,
  albumTitle,
  sourceLabel,
  sourceUrl,
}: {
  photos: AlbumGalleryPhoto[];
  albumTitle: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const items: LightboxItem[] = photos.map((p) => ({ id: p.id, src: p.display, width: p.width, height: p.height, alt: p.alt || albumTitle }));
  const current = open !== null ? photos[open] : null;
  const credit = sourceLabel ? (
    <span data-lightbox-credit>
      المصدر:{" "}
      {sourceUrl ? (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-on-dark underline underline-offset-4 hover:decoration-gold">
          {sourceLabel}
        </a>
      ) : (
        sourceLabel
      )}
    </span>
  ) : null;
  return (
    <>
      <ul data-photo-grid className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
        {photos.map((p, i) => (
          <li key={p.id}>
            <Thumb p={p} index={i} onOpen={() => setOpen(i)} />
          </li>
        ))}
      </ul>
      {open !== null && current ? (
        <Lightbox
          items={items}
          index={open}
          onIndexChange={setOpen}
          onClose={() => setOpen(null)}
          label={`صور: ${albumTitle}`}
          footer={
            <div className="flex flex-col items-center gap-1">
              {current.alt ? <p data-lightbox-alt className="text-on-dark/90">{current.alt}</p> : null}
              {credit}
            </div>
          }
        />
      ) : null}
    </>
  );
}
