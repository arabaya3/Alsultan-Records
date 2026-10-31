import Link from "next/link";
import { photoUrl, type PhotoAlbum } from "@/features/public-content/gallery-model";
import { arNum, formatDateAr } from "@/features/public-content/labels";
import { bidiDir } from "@/lib/bidi";

export { arNum };
export const photoCountLabel = (n: number) => (n === 1 ? "صورة واحدة" : n === 2 ? "صورتان" : n <= 10 ? `${arNum(n)} صور` : `${arNum(n)} صورة`);

/** Variants fit inside a square (thumb 480px, display 1600px), so in this 2:3 frame the thumb is sharp up to ~320px
 *  of rendered width and the display up to ~1066px — the srcset widths say exactly that, the browser picks. */
/** One column of a grid inside the content width (max 1440px, gutters 2×3.5rem, 24px gaps). */
export const coverColumn = (cols: number) => `calc((min(100vw, 1440px) - 7rem - ${(cols - 1) * 24}px) / ${cols})`;
const COVER_SIZES = `(max-width: 767px) 50vw, (max-width: 1023px) 33vw, ${coverColumn(4)}`;

/** Album tile: whole cover (contain, never cropped or stretched, no hover zoom) in a reserved 2:3 portrait frame,
 *  via the gated /p route (display variant: fit-inside, watermarked, never the original), then title, date, photo count. */
export function AlbumCard({ album, priority = false, sizes = COVER_SIZES }: { album: PhotoAlbum; priority?: boolean; sizes?: string }) {
  const meta = [formatDateAr(album.event_date ?? album.published_at?.slice(0, 10) ?? album.created_at?.slice(0, 10) ?? null), photoCountLabel(album.photoCount)].filter(Boolean).join(" · ");
  return (
    <Link href={`/work/albums/${album.slug}`} data-album-card={album.slug} className="group flex h-full flex-col rounded-lg">
      <span className="relative block aspect-[2/3] overflow-hidden rounded-lg border border-hairline-gold bg-night-deep transition-[border-color,box-shadow,transform] duration-300 group-hover:-translate-y-0.5 group-hover:border-gold group-hover:shadow-[0_10px_30px_-14px_rgb(233_185_73/0.5)] motion-reduce:group-hover:translate-y-0">
        {album.coverId ? (
          // Gated, short-lived same-origin bytes: plain <img> (no optimizer cache in the withdrawal path).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl(album.coverId, "display")}
            srcSet={`${photoUrl(album.coverId, "thumb")} 320w, ${photoUrl(album.coverId, "display")} 1066w`}
            sizes={sizes}
            alt=""
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className="absolute inset-0 size-full object-contain"
          />
        ) : null}
      </span>
      <span className="mt-3 line-clamp-2 font-display text-lg font-semibold leading-snug break-words text-ivory transition-colors group-hover:text-gold">
        <bdi dir={bidiDir(album.title)}>{album.title}</bdi>
      </span>
      {meta ? <span className="mt-auto pt-1 text-sm text-ivory-muted">{meta}</span> : null}
    </Link>
  );
}
