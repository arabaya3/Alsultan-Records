"use client";

import Image from "next/image";
import { useState } from "react";
import { PlayBadge } from "@/components/ui/Button";
import { isYouTubeId, youTubeEmbedUrl, youTubeThumbUrl } from "@/lib/youtube";

/**
 * In-page click-to-load player (video page). Before the click only the thumbnail exists; the
 * privacy-enhanced youtube-nocookie iframe is mounted in the same reserved 16:9 box after it.
 */
export function InlinePlayer({ youtubeId, title }: { youtubeId: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  if (!isYouTubeId(youtubeId)) return null;
  return (
    <div data-inline-player={youtubeId} className="relative aspect-video w-full overflow-hidden rounded-lg bg-black ring-1 ring-hairline-gold shadow-[0_24px_60px_-30px_rgb(233_185_73/0.45)]">
      {playing ? (
        <iframe
          src={youTubeEmbedUrl(youtubeId)}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 size-full border-0"
        />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} aria-label={`تشغيل الفيديو: ${title}`} className="group absolute inset-0 block">
          <Image src={youTubeThumbUrl(youtubeId)} alt="" fill unoptimized priority sizes="(min-width: 1024px) 66vw, 100vw" className="object-cover" />
          <span aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-black/70 via-black/10 to-transparent" />
          <PlayBadge size={72} className="absolute inset-0 m-auto bg-black/45 text-gold transition-colors group-hover:bg-gold group-hover:text-ink" />
        </button>
      )}
    </div>
  );
}
