import Link from "next/link";
import { photoUrl, type PhotoAlbum } from "@/features/public-content/gallery-model";
import { formatDateAr } from "@/features/public-content/labels";

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const arNum = (n: number) => String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
export const photoCountLabel = (n: number) => (n === 1 ? "صورة واحدة" : n === 2 ? "صورتان" : n <= 10 ? `${arNum(n)} صور` : `${arNum(n)} صورة`);

/** Album tile: cover via the gated /p route (thumb variant), reserved 4:3, title, date, photo count. */
export function AlbumCard({ album, priority = false }: { album: PhotoAlbum; priority?: boolean }) {
  const meta = [formatDateAr(album.event_date), photoCountLabel(album.photoCount)].filter(Boolean).join(" · ");
  return (
    <Link href={`/work/albums/${album.slug}`} data-album-card={album.slug} className="group flex h-full flex-col">
      <span className="relative block aspect-[4/3] overflow-hidden rounded-sm bg-cream-line">
        {album.coverId ? (
          // Gated, short-lived same-origin bytes: plain <img> (no optimizer cache in the withdrawal path).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl(album.coverId, "thumb")}
            alt=""
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className="absolute inset-0 size-full object-cover object-[50%_18%] transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : null}
      </span>
      <span className="mt-3 line-clamp-2 font-display text-lg font-semibold leading-snug break-words group-hover:text-gold-press">
        <bdi>{album.title}</bdi>
      </span>
      {meta ? <span className="mt-auto pt-1 text-sm text-on-cream-muted">{meta}</span> : null}
    </Link>
  );
}
