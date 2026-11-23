import { activeLogoSrc } from "@/components/brand/Logo";
import { PosterAbout, PosterContactBar, PosterHero, PosterServices, PosterWorks, type PosterWork } from "@/components/home/HomePoster";
import { JsonLd } from "@/components/ui/JsonLd";
import { getSiteSections } from "@/features/public-content/cms-queries";
import { bookingHref, telHref } from "@/features/public-content/contact";
import { cleanVideoTitle } from "@/features/public-content/labels";
import { HOME_POSTER } from "@/features/public-content/home-content";
import { homeAlbums, homeSelection, photoUrl } from "@/features/public-content/gallery-model";
import { getPublishedAlbums, getSiteHeroPhotoIds, getVideoGallery } from "@/features/public-content/gallery-queries";
import { getBusinessSettings } from "@/features/public-content/queries";
import { localBusinessJsonLd, pageMetadata, websiteJsonLd } from "@/features/public-content/seo";
import { youTubeThumbUrl } from "@/lib/youtube";

export const metadata = pageMetadata({
  description: "ستوديو وتسجيلات السلطان في ميثلون – جنين. نوثّق أعراسكم ومناسباتكم بالصوت والصورة: تصوير فوتوغرافي، أفلام أعراس وDJ.",
  path: "/",
});

/** «من أعمالنا» shows exactly this many works, each a link to its own published page. */
const WORKS_SHOWN = 2;

/**
 * Homepage = the owner's poster design, five fixed sections in this order: hero, «من نحن», «كيف نوثّق مناسبتكم»,
 * «من أعمالنا», contact bar. The copy is fixed (HOME_POSTER); what stays live is the media and the contact details:
 *   hero photo  — the site hero photo (admin «الهوية»: a chosen photo or the newest album cover; else the first album cover), through /p;
 *   works       — the owner's picks for the «works» section (else the usual selection) of published videos, then the
 *                 newest published albums if there are fewer than two videos; never a placeholder;
 *   contact     — WhatsApp, phone and active logo from business_settings.
 */
export default async function HomePage() {
  const [settings, gallery, sections, albums, heroPhotos] = await Promise.all([
    getBusinessSettings(),
    getVideoGallery(),
    getSiteSections(),
    getPublishedAlbums(),
    getSiteHeroPhotoIds(),
  ]);

  const s = settings.status === "ok" ? settings.data : null;
  const phone = s?.phone ?? HOME_POSTER.phoneFallback;
  const featured = sections.find((x) => x.key === "works")?.featured ?? [];

  const works: PosterWork[] = (gallery.status === "ok" ? homeSelection(gallery.data, WORKS_SHOWN, featured) : []).map((v) => ({
    key: v.youtube_id,
    href: `/work/v/${v.youtube_id}`,
    title: cleanVideoTitle(v.title),
    // An owner-chosen cover is an album photo (shown whole); otherwise the video's own 16:9 thumbnail.
    src: v.custom_cover_photo_id ? photoUrl(v.custom_cover_photo_id, "display") : youTubeThumbUrl(v.youtube_id),
    fit: v.custom_cover_photo_id ? "contain" : "cover",
  }));
  if (works.length < WORKS_SHOWN && albums.status === "ok") {
    for (const a of homeAlbums(albums.data.filter((x) => x.photoCount > 0 && x.coverId), WORKS_SHOWN - works.length)) {
      works.push({
        key: a.slug,
        href: `/work/albums/${a.slug}`,
        title: a.title,
        src: photoUrl(a.coverId!, "display"),
        srcSet: `${photoUrl(a.coverId!, "thumb")} 320w, ${photoUrl(a.coverId!, "display")} 1066w`,
        fit: "contain",
      });
    }
  }

  return (
    <>
      <JsonLd data={websiteJsonLd()} />
      {s ? <JsonLd data={localBusinessJsonLd(s)} /> : null}

      <PosterHero photoSrc={heroPhotos[0] ? photoUrl(heroPhotos[0], "display") : null} logoSrc={activeLogoSrc(s?.active_logo_id)} whatsappHref={bookingHref(s)} />
      <div className="tone-ivory bg-ivory-band text-on-cream">
        <PosterAbout />
        <PosterServices />
        <PosterWorks works={works} />
        <PosterContactBar whatsappHref={bookingHref(s)} phone={{ label: phone, href: telHref(phone) }} />
      </div>
    </>
  );
}
