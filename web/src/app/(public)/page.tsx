import { activeLogoSrc } from "@/components/brand/Logo";
import { HeroSlideshow } from "@/components/home/HeroSlideshow";
import { PosterAbout, PosterBand, PosterContactBar, PosterHero, PosterServices, PosterWorks, type HeroPhoto, type PosterWork } from "@/components/home/HomePoster";
import { AlbumCard, coverColumn } from "@/components/media/gallery/AlbumCard";
import { YouTubeCard } from "@/components/media/youtube/YouTubeCard";
import { OfferCard } from "@/components/offers/OfferCard";
import { OfferCarousel, type CarouselOffer } from "@/components/offers/OfferCarousel";
import { listPreview } from "@/lib/text-blocks";
import { offerPath } from "@/lib/site-targets";
import { GridIcon, IconLink } from "@/components/ui/IconLink";
import { JsonLd } from "@/components/ui/JsonLd";
import type { SectionConfig } from "@/features/public-content/cms-model";
import { getActiveOffers, getProcessSteps, getSiteSections } from "@/features/public-content/cms-queries";
import { bookingHref, telHref } from "@/features/public-content/contact";
import { homeAlbums, homeSelection, photoUrl, promoVideos, toCardVideo } from "@/features/public-content/gallery-model";
import { getPublishedAlbums, getSiteHeroPhotoIds, getVideoGallery } from "@/features/public-content/gallery-queries";
import { HOME_POSTER } from "@/features/public-content/home-content";
import { cleanVideoTitle, durationLabel } from "@/features/public-content/labels";
import { getBusinessSettings } from "@/features/public-content/queries";
import { localBusinessJsonLd, pageMetadata, websiteJsonLd } from "@/features/public-content/seo";
import { SITE_TARGETS } from "@/lib/site-targets";
import { youTubeThumbUrl } from "@/lib/youtube";

export const metadata = pageMetadata({
  description: "ستوديو وتسجيلات السلطان في ميثلون – جنين. نوثّق أعراسكم ومناسباتكم بالصوت والصورة: تصوير فوتوغرافي، أفلام أعراس وDJ.",
  path: "/",
});

/** Owner picks first (in their order), then the rest, capped at the section's limit. */
function pick<T extends { id: string }>(list: T[], cfg: SectionConfig): T[] {
  if (cfg.featured.length) {
    const byId = new Map(list.map((x) => [x.id, x]));
    const chosen = cfg.featured.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    if (chosen.length) return chosen.slice(0, cfg.limit);
  }
  return list.slice(0, cfg.limit);
}

/** Heading ids stay stable for anchors/tests. */
const HEADING_ID: Record<SectionConfig["key"], string> = {
  works: "work-title",
  services: "services-title",
  process: "steps-title",
  offers: "offers-title",
  promos: "promos-title",
  albums: "albums-title",
  about: "about-title",
  contact: "contact-title",
  stats: "stats-title",
};

/** Sections drawn in the poster's own ivory style; the others get a navy band with the site's cards. */
const IVORY = new Set<SectionConfig["key"]>(["about", "services", "works"]);

/**
 * Homepage in the owner's poster design. What the admin saves decides what is here:
 *   hero      — title, text under it and WhatsApp button label from «الصفحة الرئيسية» (empty = the poster's text); the hero
 *               photo follows the saved source (a chosen photo or the newest published album), only through /p;
 *   sections  — «القائمة والأقسام»: each visible section, in the saved order, with its saved title and intro. The poster's
 *               own four are «من نحن», the services columns, «من أعمالنا» and the contact bar; offers, newest albums, the
 *               counter, promos and «كيف نشتغل» keep their content rules (offers only while one is active, albums strictly
 *               by latest publish, the counter only with the owner's number) in a navy band;
 *   contact   — WhatsApp, phone and logo from business_settings.
 */
export default async function HomePage() {
  const [settings, gallery, sections, offers, steps, albums, heroPhotos] = await Promise.all([
    getBusinessSettings(),
    getVideoGallery(),
    getSiteSections(),
    getActiveOffers(),
    getProcessSteps(),
    getPublishedAlbums(),
    getSiteHeroPhotoIds(),
  ]);

  const s = settings.status === "ok" ? settings.data : null;
  const book = bookingHref(s);
  const g = gallery.status === "ok" ? gallery.data : null;
  const ctaLabel = s?.hero_primary_label ?? null;
  const publishedAlbums = albums.status === "ok" ? albums.data.filter((a) => a.photoCount > 0) : [];
  // The saved hero source first (a chosen photo, or the newest published album); also shown in «من نحن».
  const hero: HeroPhoto | null = heroPhotos[0] ? { src: photoUrl(heroPhotos[0], "display"), placeholderSrc: photoUrl(heroPhotos[0], "thumb") } : null;

  const carouselShown = offers.status === "ok" && offers.data.length > 0;

  const worksFor = (c: SectionConfig): PosterWork[] => {
    const list: PosterWork[] = (g ? homeSelection(g, c.limit, c.featured) : []).map((v) => ({
      key: v.youtube_id,
      href: `/work/v/${v.youtube_id}`,
      title: cleanVideoTitle(v.title),
      // An owner-chosen cover is an album photo (shown whole); otherwise the video's own 16:9 thumbnail.
      src: v.custom_cover_photo_id ? photoUrl(v.custom_cover_photo_id, "display") : youTubeThumbUrl(v.youtube_id),
      fit: v.custom_cover_photo_id ? "contain" : "cover",
      video: true,
    }));
    // No video published yet: the newest published albums stand in (never a placeholder).
    if (!list.length) {
      for (const a of homeAlbums(publishedAlbums.filter((x) => x.coverId), c.limit)) {
        list.push({
          key: a.slug,
          href: `/work/albums/${a.slug}`,
          title: a.title,
          src: photoUrl(a.coverId!, "display"),
          srcSet: `${photoUrl(a.coverId!, "thumb")} 320w, ${photoUrl(a.coverId!, "display")} 1066w`,
          fit: "contain",
        });
      }
    }
    return list;
  };

  const renderSection = (c: SectionConfig, over: "ivory" | "navy") => {
    const hid = HEADING_ID[c.key];
    switch (c.key) {
      case "about":
        return <PosterAbout key={c.key} title={c.title} intro={c.intro} photo={hero} />;
      case "services":
        return <PosterServices key={c.key} title={c.title} intro={c.intro} />;
      case "works":
        return <PosterWorks key={c.key} title={c.title} intro={c.intro} works={worksFor(c)} />;
      case "contact":
        return (
          <PosterContactBar
            key={c.key}
            whatsappHref={book}
            phone={(() => {
              const phone = s?.phone ?? HOME_POSTER.phoneFallback;
              return { label: phone, href: telHref(phone) };
            })()}
            ctaLabel={ctaLabel}
            over={over}
          />
        );
      case "offers": {
        // Active offers are in the strip under the hero; the page never shows them twice.
        if (carouselShown) return null;
        const list = offers.status === "ok" ? pick(offers.data, c) : [];
        if (!list.length) return null;
        return (
          <PosterBand
            key={c.key}
            id={hid}
            name="offers"
            title={c.title}
            intro={c.intro}
            action={
              <IconLink href="/offers" label="كل العروض" text>
                <GridIcon />
              </IconLink>
            }
          >
            <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((o) => (
                <li key={o.id} className="h-full">
                  <OfferCard offer={o} />
                </li>
              ))}
            </ul>
          </PosterBand>
        );
      }
      case "promos": {
        const list = g ? pick(promoVideos(g), c) : [];
        if (!list.length) return null;
        return (
          <PosterBand
            key={c.key}
            id={hid}
            name="promos"
            title={c.title}
            intro={c.intro}
            action={
              <IconLink href={SITE_TARGETS.promos.path} label="كل البروموهات" text>
                <GridIcon />
              </IconLink>
            }
          >
            <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((v) => (
                <li key={v.id} className="h-full">
                  <YouTubeCard video={{ ...toCardVideo(v, durationLabel(v.duration_seconds)), categories: [] }} />
                </li>
              ))}
            </ul>
          </PosterBand>
        );
      }
      case "albums": {
        // Strictly by latest publish (homeAlbums); the owner's stored picks are kept but not mixed in.
        const list = homeAlbums(publishedAlbums, c.limit);
        if (!list.length) return null;
        return (
          <PosterBand
            key={c.key}
            id={hid}
            name="albums"
            title={c.title}
            intro={c.intro}
            action={
              <IconLink href={SITE_TARGETS.albums.path} label="كل الألبومات" text>
                <GridIcon />
              </IconLink>
            }
          >
            <ul className={`grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-6 sm:gap-y-10 ${list.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
              {list.map((a) => (
                <li key={a.id} className="h-full">
                  <AlbumCard album={a} sizes={`(max-width: 1023px) 50vw, ${coverColumn(list.length === 4 ? 4 : 3)}`} />
                </li>
              ))}
            </ul>
          </PosterBand>
        );
      }
      case "process": {
        const list = steps.slice(0, c.limit);
        if (!list.length) return null;
        return (
          <PosterBand key={c.key} id={hid} name="process" title={c.title} intro={c.intro}>
            <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
              {list.map((step, i) => (
                <li key={step.key} className="border-t border-hairline-gold pt-5">
                  {step.photoId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl(step.photoId, "thumb")} alt="" loading="lazy" decoding="async" className="mb-4 aspect-[4/3] w-full rounded-sm bg-night-deep object-contain" />
                  ) : null}
                  <span className="font-display text-sm text-gold">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="mt-2 text-xl font-semibold break-words">{step.title}</h3>
                  {step.body ? <p className="mt-2 text-ivory-muted">{step.body}</p> : null}
                </li>
              ))}
            </ol>
          </PosterBand>
        );
      }
      case "stats":
        // Owner-entered number only (admin «عدّاد الحفلات»); never rendered without one.
        if (!c.stat) return null;
        return (
          <section key={c.key} aria-labelledby={hid} data-home-section="stats" data-tone="navy" className="tone-dark bg-navy py-10 text-center text-ivory sm:py-12">
            <div className="mx-auto flex w-full max-w-[70rem] flex-col items-center px-[var(--gutter)]">
              <h2 id={hid} className="flex flex-col items-center gap-3">
                <span data-stat-value className="font-display text-[clamp(3.5rem,11vw,7.5rem)] leading-none font-bold tracking-tight text-gold" dir="ltr">
                  {c.stat.toLocaleString("en-US")}
                </span>
                <span className="text-h3 font-bold">{c.title}</span>
              </h2>
              <span aria-hidden="true" className="gold-rule mx-auto mt-5" />
              {c.intro ? <p className="mt-5 max-w-2xl text-lg whitespace-pre-line text-ivory-muted">{c.intro}</p> : null}
            </div>
          </section>
        );
    }
  };

  // Visible sections in the owner's order; a section with nothing to show is skipped, never an empty box.
  const rendered: React.ReactNode[] = [];
  let over: "ivory" | "navy" = "navy"; // the hero
  for (const c of sections.filter((x) => x.visible)) {
    const node = renderSection(c, over);
    if (!node) continue;
    rendered.push(node);
    over = IVORY.has(c.key) ? "ivory" : "navy";
  }


  // Hero slideshow: published albums with photos, newest published first (the order getPublishedAlbums returns). The
  // opening photo is the saved hero photo; its album is named when it is that album's cover.
  const slideAlbums = publishedAlbums.map((a) => ({ slug: a.slug, title: a.title }));
  const heroAlbum = heroPhotos[0] ? (publishedAlbums.find((a) => a.coverId === heroPhotos[0]) ?? null) : null;

  // Home offer carousel: every active offer (owner order), its own first line and its own image only.
  const firstLine = (t: string | null | undefined) =>
    listPreview(t, 1)?.items[0] ??
    (t ?? "")
      .split("\n")
      .map((x) => x.replace(/^\s*(\d+[.)]|[-•])\s*/, "").trim())
      .find(Boolean) ??
    null;
  const carousel: CarouselOffer[] = offers.status === "ok"
    ? offers.data.map((o) => ({ slug: o.slug, href: offerPath(o.slug), title: o.title, sub: firstLine(o.description), image: o.image_photo_id ? photoUrl(o.image_photo_id, "display") : null }))
    : [];

  return (
    <>
      <JsonLd data={websiteJsonLd()} />
      {s ? <JsonLd data={localBusinessJsonLd(s)} /> : null}

      <PosterHero
        photo={hero}
        photoSlot={
          hero ? (
            <HeroSlideshow
              albums={slideAlbums}
              first={{ id: heroPhotos[0], album: heroAlbum ? { slug: heroAlbum.slug, title: heroAlbum.title } : null, n: null, total: null }}
              fallback={null}
            />
          ) : undefined
        }
        logoSrc={activeLogoSrc(s?.active_logo_id)} whatsappHref={book} title={s?.hero_title ?? null} sub={s?.hero_subtitle ?? null} ctaLabel={ctaLabel} />
      {carousel.length ? (
        // Active offers between the hero and the first section (owner design); the top offer bar is hidden on this page.
        <div className="bg-navy px-[var(--gutter)] pt-5 pb-6 sm:pt-6 sm:pb-8">
          <div className="mx-auto w-full max-w-[var(--content-max)]">
            <OfferCarousel offers={carousel} />
          </div>
        </div>
      ) : null}
      {rendered}
    </>
  );
}
