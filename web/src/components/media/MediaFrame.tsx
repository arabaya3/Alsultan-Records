import Image from "next/image";
import type { ReactNode } from "react";
import type { PublicMedia } from "@/features/public-content/schema";
import { PlaceholderMedia } from "./Placeholder";
import { InViewVideo } from "./InViewVideo";

export type Ratio = "16/9" | "16/7" | "4/3" | "3/4" | "1/1" | "21/9";

const RATIO_CLASS: Record<Ratio, string> = {
  "16/9": "aspect-[16/9]",
  "16/7": "aspect-[16/7]",
  "4/3": "aspect-[4/3]",
  "3/4": "aspect-[3/4]",
  "1/1": "aspect-square",
  "21/9": "aspect-[21/9]",
};

/**
 * Media box with a reserved aspect ratio (no layout shift).
 * - image → next/image (fill, object-cover)
 * - video → poster image; `playable` renders an inline, muted, user-controlled video
 * - no media → neutral placeholder (dev only)
 */
export function MediaFrame({
  media,
  alt,
  ratio = "16/9",
  ratioClassName,
  sizes = "(min-width: 768px) 50vw, 100vw",
  priority = false,
  playable = false,
  tone = "ink",
  className = "",
  children,
}: {
  media: PublicMedia | null;
  alt: string;
  ratio?: Ratio;
  /** Override the ratio with responsive classes, e.g. "aspect-[4/3] md:aspect-[16/7]". */
  ratioClassName?: string;
  sizes?: string;
  priority?: boolean;
  playable?: boolean;
  tone?: "ink" | "cream";
  className?: string;
  children?: ReactNode;
}) {
  const still = media ? (media.kind === "image" ? media.src : media.poster) : null;
  return (
    <div
      className={`relative overflow-hidden rounded-sm bg-ink-2 ${ratioClassName ?? RATIO_CLASS[ratio]} ${className}`}
    >
      {media && media.kind === "video" && playable ? (
        <InViewVideo src={media.src} poster={media.poster} label={alt} />
      ) : still ? (
        <Image
          src={still}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          // Remote Supabase storage host is not in images.remotePatterns yet (lead-owned config).
          unoptimized
          className="object-cover"
        />
      ) : (
        <PlaceholderMedia tone={tone} />
      )}
      {children}
    </div>
  );
}
