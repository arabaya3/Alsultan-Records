"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { PlayBadge } from "@/components/ui/Button";
import { isYouTubeId, youTubeThumbUrl } from "@/lib/youtube";
import { YouTubeDialog } from "./YouTubeDialog";

/** Hero promo: large thumbnail with "شاهد البرومو" that opens the player dialog (no autoplay on load). */
export function PromoPlayer({
  youtubeId,
  title,
  caption,
  duration,
}: {
  youtubeId: string;
  title: string;
  caption: string;
  duration?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!isYouTubeId(youtubeId)) return null;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-promo-trigger
        className="group relative block aspect-video w-full overflow-hidden rounded-md bg-black text-start ring-1 ring-hairline-gold"
      >
        <Image
          src={youTubeThumbUrl(youtubeId)}
          alt=""
          fill
          unoptimized
          priority
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="object-cover"
        />
        <span aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-black/85 via-black/15 to-transparent" />
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-4 p-4 sm:p-5">
          <PlayBadge size={56} className="bg-black/40 text-gold transition-colors duration-200 group-hover:bg-gold group-hover:text-ink" />
          <span className="min-w-0">
            <span className="block font-display text-lg font-semibold text-ivory sm:text-xl">شاهد البرومو</span>
            <span className="block truncate text-sm text-ivory/85">
              {caption}
              {duration ? ` · ${duration}` : ""}
            </span>
          </span>
        </span>
      </button>
      <YouTubeDialog video={open ? { youtubeId, title } : null} onClose={() => setOpen(false)} returnFocus={triggerRef} />
    </>
  );
}
