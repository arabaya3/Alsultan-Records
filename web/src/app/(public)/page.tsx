import Link from "next/link";
import { activeLogoSrc } from "@/components/brand/Logo";
import { HeroIntro } from "@/components/home/HeroIntro";
import { AlbumCard } from "@/components/media/gallery/AlbumCard";
import { YouTubeCard } from "@/components/media/youtube/YouTubeCard";
import { Reveal } from "@/components/motion/Reveal";
import { MaskReveal } from "@/components/motion/ScrollEffects";
import { OfferCard } from "@/components/offers/OfferCard";
import { JsonLd } from "@/components/ui/JsonLd";
import { PROMO_CAPTION, promoVideoJsonLd } from "@/components/media/promo/promo-seo";
import { Section, SectionHeading } from "@/components/ui/Layout";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import type { SectionConfig } from "@/features/public-content/cms-model";
import { getActiveOffers, getProcessSteps, getSiteSections } from "@/features/public-content/cms-queries";
import { bookingHref, telHref } from "@/features/public-content/contact";
import { FALLBACK_SERVICES, HERO } from "@/features/public-content/home-content";
import { homeSelection, photoUrl, promoVideos, toCardVideo } from "@/features/public-content/gallery-model";
import { getPublishedAlbums, getVideoGallery } from "@/features/public-content/gallery-queries";
import { durationLabel } from "@/features/public-content/labels";
import { getBusinessSettings, getPublishedServices } from "@/features/public-content/queries";
import { CORE_SERVICES, SITE_NAME_AR } from "@/features/public-content/site";
import { localBusinessJsonLd, pageMetadata, safeHttp } from "@/features/public-content/seo";
import { SITE_TARGETS } from "@/lib/site-targets";

export const metadata = pageMetadata({
  description: "ستوديو وتسجيلات السلطان في ميثلون – جنين. نوثّق أعراسكم ومناسباتكم بالصوت والصورة: تصوير فوتوغرافي، أفلام أعراس وDJ.",
  path: "/",
});

function ChevronStart() {
  // "Forward" in RTL points left.
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

const INTRO_ARM_SCRIPT = `try{if(matchMedia("(prefers-reduced-motion: no-preference)").matches)document.documentElement.classList.add("intro-armed")}catch(e){}`;

const linkCls = "inline-flex min-h-11 items-center gap-2 underline decoration-1 underline-offset-8 hover:decoration-gold";

/** Owner picks first (in their order), then the rest, capped at the section's limit. */
function pick<T extends { id: string }>(list: T[], cfg: SectionConfig): T[] {
  if (cfg.featured.length) {
    const byId = new Map(list.map((x) => [x.id, x]));
    const chosen = cfg.featured.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    if (chosen.length) return chosen.slice(0, cfg.limit);
  }
  return list.slice(0, cfg.limit);
}

/** Heading ids stay stable for anchors/tests: the 3 historical ones keep their names. */
const HEADING_ID: Record<SectionConfig["key"], string> = {
  works: "work-title",
  services: "services-title",
  process: "steps-title",
  offers: "offers-title",
  promos: "promos-title",
  albums: "albums-title",
  about: "about-title",
  contact: "contact-title",
};

export default async function HomePage() {
  const [settings, gallery, services, sections, offers, steps, albums] = await Promise.all([
    getBusinessSettings(),
    getVideoGallery(),
    getPublishedServices(),
    getSiteSections(),
    getActiveOffers(),
    getProcessSteps(),
    getPublishedAlbums(),
  ]);

  const s = settings.status === "ok" ? settings.data : null;
  const book = bookingHref(s);
  const g = gallery.status === "ok" ? gallery.data : null;
  const cfg = (k: SectionConfig["key"]) => sections.find((x) => x.key === k)!;
  const works = g ? homeSelection(g, cfg("works").limit, cfg("works").featured) : [];
  const channel = safeHttp(s?.youtube_url ?? null);
  const serviceList =
    services.status === "ok" && services.data.length
      ? pick(services.data, cfg("services")).map((x) => ({ key: x.id, title: x.title, summary: x.summary, href: `/services/${x.slug}` }))
      : FALLBACK_SERVICES.map((x) => ({ key: x.title, title: x.title, summary: x.summary, href: "/services" }));
  const offerList = offers.status === "ok" ? pick(offers.data, cfg("offers")) : [];
  const promoList = g ? pick(promoVideos(g), cfg("promos")) : [];
  const albumList = albums.status === "ok" ? pick(albums.data.filter((a) => a.photoCount > 0), cfg("albums")) : [];

  // Hero promo: the self-hosted studio promo by default; the owner may switch to a published YouTube promo.
  const ytPromo =
    s?.hero_promo_source === "youtube" && g
      ? (g.videos.find((v) => v.id === s.hero_promo_video_id) ?? g.promo ?? promoVideos(g)[0] ?? null)
      : null;

  const renderSection = (c: SectionConfig, tone: "cream" | "cream-2") => {
    const hid = HEADING_ID[c.key];
    switch (c.key) {
      case "works":
        if (gallery.status === "ok" && works.length === 0) return null;
        return (
          <Section key={c.key} tone={tone} labelledBy={hid}>
            <SectionHeading
              id={hid}
              title={c.title}
              lead={c.intro ?? undefined}
              action={
                <div className="flex flex-wrap items-center gap-x-6">
                  {channel ? (
                    <a href={channel} target="_blank" rel="noopener noreferrer" className={linkCls}>
                      قناتنا على YouTube
                    </a>
                  ) : null}
                  <Link href="/work" className={linkCls}>
                    كل الأعمال
                    <ChevronStart />
                  </Link>
                </div>
              }
            />
            {gallery.status === "unavailable" ? (
              <p role="status" className="text-on-cream-muted">
                تعذّر تحميل الفيديوهات الآن. جرّب مرة أخرى بعد قليل.
              </p>
            ) : (
              <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                {works.map((v, i) => (
                  <li key={v.id} className="h-full">
                    <MaskReveal index={i % 3} className="h-full">
                      <YouTubeCard video={{ ...toCardVideo(v, durationLabel(v.duration_seconds)), categories: v.primary ? [v.primary] : [] }} />
                    </MaskReveal>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        );
      case "services":
        return (
          <Section key={c.key} tone={tone} labelledBy={hid}>
            <SectionHeading
              id={hid}
              title={c.title}
              lead={c.intro ?? undefined}
              action={
                <Link href="/services" className={linkCls}>
                  تفاصيل الخدمات
                  <ChevronStart />
                </Link>
              }
            />
            <Reveal onScroll>
              <ol className="divide-y divide-cream-line border-y border-cream-line">
                {serviceList.map((x, i) => (
                  <li key={x.key} data-reveal>
                    <Link href={x.href} className="group grid items-baseline gap-2 py-6 md:grid-cols-[4rem_1fr_2fr] md:gap-8 md:py-7">
                      <span className="font-display text-sm text-on-cream-muted" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-display text-2xl font-semibold transition-colors group-hover:text-gold-press md:text-3xl">
                        <bdi>{x.title}</bdi>
                      </span>
                      {x.summary ? <span className="text-on-cream-muted md:text-lg">{x.summary}</span> : null}
                    </Link>
                  </li>
                ))}
              </ol>
            </Reveal>
          </Section>
        );
      case "offers":
        if (!offerList.length) return null;
        return (
          <Section key={c.key} tone={tone} labelledBy={hid}>
            <div data-home-section="offers">
              <SectionHeading
                id={hid}
                title={c.title}
                lead={c.intro ?? undefined}
                action={
                  <Link href="/offers" className={linkCls}>
                    كل العروض
                    <ChevronStart />
                  </Link>
                }
              />
              <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                {offerList.map((o) => (
                  <li key={o.id} className="h-full">
                    <OfferCard offer={o} />
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        );
      case "promos":
        if (!promoList.length) return null;
        return (
          <Section key={c.key} tone={tone} labelledBy={hid}>
            <div data-home-section="promos">
              <SectionHeading
                id={hid}
                title={c.title}
                lead={c.intro ?? undefined}
                action={
                  <Link href={SITE_TARGETS.promos.path} className={linkCls}>
                    كل البروموهات
                    <ChevronStart />
                  </Link>
                }
              />
              <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                {promoList.map((v) => (
                  <li key={v.id} className="h-full">
                    <YouTubeCard video={{ ...toCardVideo(v, durationLabel(v.duration_seconds)), categories: [] }} />
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        );
      case "albums":
        if (!albumList.length) return null;
        return (
          <Section key={c.key} tone={tone} labelledBy={hid}>
            <div data-home-section="albums">
              <SectionHeading
                id={hid}
                title={c.title}
                lead={c.intro ?? undefined}
                action={
                  <Link href={SITE_TARGETS.albums.path} className={linkCls}>
                    كل الألبومات
                    <ChevronStart />
                  </Link>
                }
              />
              <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                {albumList.map((a) => (
                  <li key={a.id} className="h-full">
                    <AlbumCard album={a} />
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        );
      case "process": {
        const list = steps.slice(0, c.limit);
        if (!list.length) return null;
        return (
          <Section key={c.key} tone={tone} labelledBy={hid}>
            <SectionHeading id={hid} title={c.title} lead={c.intro ?? undefined} />
            <Reveal onScroll>
              <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
                {list.map((step, i) => (
                  <li key={step.key} data-reveal className="border-t-2 border-on-cream pt-5">
                    {step.photoId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrl(step.photoId, "thumb")} alt="" loading="lazy" decoding="async" className="mb-4 aspect-[4/3] w-full rounded-sm object-cover" />
                    ) : null}
                    <span className="font-display text-sm text-gold-text">{String(i + 1).padStart(2, "0")}</span>
                    <h3 className="mt-2 text-xl font-semibold break-words">{step.title}</h3>
                    {step.body ? <p className="mt-2 text-on-cream-muted">{step.body}</p> : null}
                  </li>
                ))}
              </ol>
            </Reveal>
          </Section>
        );
      }
      case "about":
        return (
          <Section key={c.key} tone={tone} labelledBy={hid}>
            <div data-home-section="about" className="max-w-3xl">
              <h2 id={hid} className="text-3xl font-bold tracking-tight md:text-[2.5rem]">{c.title}</h2>
              {c.intro ? <p className="mt-4 text-lg whitespace-pre-line text-on-cream-muted">{c.intro}</p> : null}
              <Link href="/about" className={`${linkCls} mt-4`}>
                اعرف عنا أكثر
                <ChevronStart />
              </Link>
            </div>
          </Section>
        );
      case "contact":
        return (
          <Section key={c.key} tone={tone} labelledBy={hid}>
            <div data-home-section="contact" className="flex flex-col items-start gap-4">
              <h2 id={hid} className="text-3xl font-bold tracking-tight md:text-[2.5rem]">{c.title}</h2>
              {c.intro ? <p className="max-w-3xl text-lg whitespace-pre-line text-on-cream-muted">{c.intro}</p> : null}
              <WhatsAppCta />
            </div>
          </Section>
        );
    }
  };

  // Render visible sections in the owner's order; tones alternate over what is actually shown.
  const rendered: React.ReactNode[] = [];
  for (const c of sections) {
    if (!c.visible) continue;
    const node = renderSection(c, rendered.length % 2 ? "cream-2" : "cream");
    if (node) rendered.push(node);
  }

  return (
    <>
      {s ? <JsonLd data={localBusinessJsonLd(s)} /> : null}
      {ytPromo ? null : <JsonLd data={promoVideoJsonLd()} />}

      {/* Inline, before the hero markup: arms the intro for the first paint (motion allowed only). */}
      <script dangerouslySetInnerHTML={{ __html: INTRO_ARM_SCRIPT }} />
      <HeroIntro
        brand={SITE_NAME_AR}
        title={s?.hero_title ?? HERO.title}
        sub={s?.hero_subtitle ?? HERO.sub}
        services={CORE_SERVICES}
        workHref={g && g.videos.length ? "/work" : null}
        whatsappHref={book}
        phone={s?.phone ? { label: s.phone, href: telHref(s.phone) } : null}
        promo={{
          caption: PROMO_CAPTION,
          coverSrc: s?.hero_cover_photo_id ? photoUrl(s.hero_cover_photo_id, "display") : null,
          youtube: ytPromo ? { youtubeId: ytPromo.youtube_id, title: ytPromo.title } : null,
        }}
        strip={works.slice(0, 4).map((v) => ({ youtubeId: v.youtube_id, title: v.title }))}
        logoSrc={activeLogoSrc(s?.active_logo_id)}
        primaryLabel={s?.hero_primary_label ?? undefined}
        secondaryLabel={s?.hero_secondary_label ?? undefined}
      />

      {rendered}
    </>
  );
}
