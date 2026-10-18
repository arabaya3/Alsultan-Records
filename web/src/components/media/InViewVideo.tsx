"use client";

import { useEffect, useRef } from "react";

/**
 * User-controlled video (never autoplays, never unmuted automatically).
 * Pauses itself when scrolled out of view.
 */
export function InViewVideo({
  src,
  poster,
  label,
}: {
  src: string;
  poster: string | null;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && !v.paused) v.pause();
      },
      { threshold: 0.15 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster ?? undefined}
      controls
      playsInline
      preload="none"
      aria-label={label}
      className="absolute inset-0 size-full bg-night-deep object-contain"
    />
  );
}
