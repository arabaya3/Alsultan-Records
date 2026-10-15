"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { PublicMedia } from "@/features/public-content/schema";
import { PlayBadge } from "@/components/ui/Button";
import { MOTION_OK, prefersSaveData } from "@/components/motion/gsap";
import { PlaceholderMedia } from "./Placeholder";

/**
 * Showcase tile.
 * - Title is always visible (touch users see it without hovering; the whole tile is a link).
 * - Desktop hover (pointer: fine): image scales slightly, "شاهد المشروع" reveals, and if the
 *   cover is a video a muted preview plays — unless reduced motion or Save-Data is on.
 * - Preview video pauses when hover ends or the tile leaves the viewport.
 */
export function ProjectTile({
  href,
  title,
  meta,
  media,
  priority = false,
  ratioClassName = "aspect-[4/3] md:aspect-[16/7]",
  sizes = "(min-width: 768px) 50vw, 100vw",
}: {
  href: string;
  title: string;
  meta?: string | null;
  media: PublicMedia | null;
  priority?: boolean;
  ratioClassName?: string;
  sizes?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = media?.kind === "video";
  const still = media ? (media.kind === "image" ? media.src : media.poster) : null;

  useEffect(() => {
    const v = videoRef.current;
    if (!v || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) v.pause();
    });
    io.observe(v);
    return () => io.disconnect();
  }, []);

  function canPreview() {
    return (
      isVideo &&
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
      window.matchMedia(MOTION_OK).matches &&
      !prefersSaveData()
    );
  }

  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-sm bg-ink-2 text-on-dark"
      onPointerEnter={() => {
        if (canPreview()) void videoRef.current?.play().catch(() => {});
      }}
      onPointerLeave={() => videoRef.current?.pause()}
    >
      <div className={`relative ${ratioClassName}`}>
        {still ? (
          <Image
            src={still}
            alt=""
            fill
            sizes={sizes}
            priority={priority}
            unoptimized
            className="object-cover transition-transform duration-700 ease-[var(--ease-out)] motion-safe:group-hover:scale-[1.04]"
          />
        ) : (
          <PlaceholderMedia />
        )}
        {isVideo && media ? (
          <video
            ref={videoRef}
            src={media.src}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          />
        ) : null}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent"
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 md:p-7">
          <div className="flex min-w-0 items-center gap-4">
            <span className="min-w-0">
              <span className="block truncate font-display text-xl font-semibold md:text-[1.75rem]">
                {title}
              </span>
              {meta ? <span className="mt-1 block text-sm text-on-dark/75">{meta}</span> : null}
            </span>
          </div>
          <span className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100 md:inline">
              شاهد المشروع
            </span>
            {isVideo ? <PlayBadge size={40} className="text-on-dark" /> : null}
          </span>
        </div>
      </div>
    </Link>
  );
}
