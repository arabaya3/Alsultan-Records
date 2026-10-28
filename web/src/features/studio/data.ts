import "server-only";
import { activeLogoSrc, DEFAULT_LOGO } from "@/components/brand/Logo";
import { getActiveOffers } from "@/features/public-content/cms-queries";
import { photoUrl, workHref } from "@/features/public-content/gallery-model";
import { getPublishedAlbums } from "@/features/public-content/gallery-queries";
import { getBusinessSettings } from "@/features/public-content/queries";
import type { ReceptionItem } from "./ReceptionFrames";

/** A frame of the studio's own promo film (three grooms), without the film's title text or logo: the room shows the
 *  logo once, on the reception plaque, instead of on every print and screen. */
const STUDIO_STILL = "/studio/promo-still.webp";
import type { SharedScene } from "./StudioProvider";

/**
 * What the room shows everywhere, from the site's REAL published content (cached queries shared with the pages):
 * the active logo, the studio film's own poster on the screen, published album covers on the reception prints
 * and the shelf. Only gated same-origin variants (/p/<id>/thumb) — never an original, never a storage URL.
 */
export async function getStudioScene(): Promise<{ shared: SharedScene; reception: ReceptionItem[] }> {
  const [settings, albums, offers] = await Promise.all([getBusinessSettings(), getPublishedAlbums(), getActiveOffers()]);
  const s = settings.status === "ok" ? settings.data : null;
  const list = albums.status === "ok" ? albums.data.filter((a) => a.photoCount > 0 && a.coverId) : [];
  const thumb = (id: string | null | undefined) => (id ? photoUrl(id, "thumb") : null);
  const cover = (i: number) => thumb(list[i]?.coverId);
  const hasOffers = offers.status === "ok" && offers.data.length > 0;

  const reception: ReceptionItem[] = [
    { href: workHref({ tab: "photos" }), label: "الألبومات", caption: "صور من مناسباتنا", image: cover(0) },
    { href: workHref({ tab: "videos" }), label: "الفيديوهات", caption: "أفلام الأعراس والسهرات", image: STUDIO_STILL },
    hasOffers
      ? { href: "/offers", label: "العروض", caption: "عروض الموسم الحالية", image: cover(1) }
      : { href: "/packages", label: "البكجات", caption: "باقات التصوير والتوثيق", image: cover(1) },
  ];
  const frame = (src: string | null, key: string) => (src ? { key, src } : null);
  return {
    reception,
    shared: {
      logo: activeLogoSrc(s?.active_logo_id) ?? DEFAULT_LOGO,
      screen: STUDIO_STILL,
      reception: reception.map((r, i) => frame(r.image, `reception-${i}`)),
      shelf: [frame(cover(2), "shelf-0"), frame(cover(3), "shelf-1")],
    },
  };
}
