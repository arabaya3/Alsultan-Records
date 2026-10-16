"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { PlayBadge } from "@/components/ui/Button";
import { isYouTubeId, youTubeThumbUrl } from "@/lib/youtube";
import { YouTubeDialog } from "./YouTubeDialog";

export type CardVideo = {
  youtubeId: string;
  title: string;
  /** e.g. "٩ د" */
  duration?: string | null;
  meta?: string | null;
};

/** Thumbnail (reserved 16:9) with a gold-ring play button; opens the player dialog on click. */
export function YouTubeCard({
  video,
  priority = false,
  sizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
  tone = "light",
}: {
  video: CardVideo;
  priority?: boolean;
  sizes?: string;
  tone?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!isYouTubeId(video.youtubeId)) return null;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-youtube-card={video.youtubeId}
        className="group block w-full text-start"
      >
        <span className="relative block aspect-video overflow-hidden rounded-sm bg-ink">
          <Image
            src={youTubeThumbUrl(video.youtubeId)}
            alt=""
            fill
            unoptimized
            priority={priority}
            sizes={sizes}
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
          <span aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent" />
          <PlayBadge
            size={48}
            className="absolute bottom-3 start-3 bg-black/45 text-gold transition-colors duration-200 group-hover:bg-gold group-hover:text-ink"
          />
          {video.duration ? (
            <span className="absolute end-3 top-3 rounded-sm bg-black/75 px-2 py-0.5 text-sm text-on-dark">{video.duration}</span>
          ) : null}
        </span>
        <span
          className={`mt-3 block font-display text-lg font-semibold leading-snug transition-colors ${
            tone === "dark" ? "text-on-dark group-hover:text-gold" : "group-hover:text-gold-press"
          }`}
        >
          <bdi>{video.title}</bdi>
        </span>
        {video.meta ? (
          <span className={`mt-0.5 block text-sm ${tone === "dark" ? "text-muted" : "text-on-cream-muted"}`}>{video.meta}</span>
        ) : null}
      </button>
      <YouTubeDialog video={open ? video : null} onClose={() => setOpen(false)} returnFocus={triggerRef} />
    </>
  );
}
