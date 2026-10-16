"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { PlayBadge } from "@/components/ui/Button";
import { isYouTubeId, youTubeThumbUrl } from "@/lib/youtube";
import { YouTubeDialog, type DialogVideo } from "./YouTubeDialog";

export type CardVideo = DialogVideo & {
  /** e.g. "٩ د" */
  duration?: string | null;
  meta?: string | null;
};

/**
 * Work card: reserved 16:9 thumbnail + the ORIGINAL title (clamped to 3 lines; the full title is in
 * the dialog, the video page and the accessible name). The card is a flex column so every card in a
 * grid row ends at the same baseline regardless of title length. No iframe until the visitor clicks.
 */
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
  const dark = tone === "dark";
  const chip = `inline-flex min-h-8 items-center rounded-full border px-3 text-sm transition-colors ${
    dark ? "border-ink-line text-on-dark hover:border-gold" : "border-cream-line text-on-cream hover:border-gold-press"
  }`;
  return (
    <article data-work-card={video.youtubeId} className="flex h-full flex-col">
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
          data-card-title
          title={video.title}
          className={`mt-3 line-clamp-3 font-display text-lg font-semibold leading-snug break-words transition-colors ${
            dark ? "text-on-dark group-hover:text-gold" : "group-hover:text-gold-press"
          }`}
        >
          <span className="sr-only">تشغيل: </span>
          <bdi>{video.title}</bdi>
        </span>
      </button>
      <div data-card-footer className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
        {video.categories?.slice(0, 2).map((c) => (
          <Link key={c.slug} href={`/work?cat=${c.slug}`} data-category-chip={c.slug} className={chip}>
            {c.title}
          </Link>
        ))}
        {video.meta ? <span className={`text-sm ${dark ? "text-muted" : "text-on-cream-muted"}`}>{video.meta}</span> : null}
        {video.href ? (
          <Link
            href={video.href}
            data-details-link
            aria-label={`تفاصيل: ${video.title}`}
            className={`ms-auto inline-flex min-h-11 items-center text-sm underline decoration-1 underline-offset-4 ${
              dark ? "hover:decoration-gold" : "hover:decoration-gold-press"
            }`}
          >
            تفاصيل
          </Link>
        ) : null}
      </div>
      <YouTubeDialog video={open ? video : null} onClose={() => setOpen(false)} returnFocus={triggerRef} />
    </article>
  );
}
