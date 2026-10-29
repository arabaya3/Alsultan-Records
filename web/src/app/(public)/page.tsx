import Link from "next/link";
import { activeLogoSrc } from "@/components/brand/Logo";
import { HeroIntro } from "@/components/home/HeroIntro";
import { AlbumCard } from "@/components/media/gallery/AlbumCard";
import { YouTubeCard } from "@/components/media/youtube/YouTubeCard";
import { FadeRise, Reveal } from "@/components/motion/Reveal";
import { PackageCard } from "@/components/packages/PackageCard";
import { OfferCard } from "@/components/offers/OfferCard";
import { JsonLd } from "@/components/ui/JsonLd";
import { PROMO_CAPTION, promoVideoJsonLd } from "@/components/media/promo/promo-seo";
import { Section, SectionHeading } from "@/components/ui/Layout";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import type { SectionConfig } from "@/features/public-content/cms-model";
import { getActiveOffers, getProcessSteps, getPublishedPackages, getSiteSections } from "@/features/public-content/cms-queries";
import { bookingHref, telHref } from "@/features/public-content/contact";
import { FALLBACK_SERVICES, HERO } from "@/features/public-content/home-content";
import { homeAlbums, homeSelection, photoUrl, promoVideos, toCardVideo } from "@/features/public-content/gallery-model";
import { getPublishedAlbums, getSiteHeroPhotoId, getVideoGallery } from "@/features/public-content/gallery-queries";
import { durationLabel } from "@/features/public-content/labels";
import { getBusinessSettings, getPublishedServices } from "@/features/public-content/queries";
import { CORE_SERVICES, SITE_NAME_AR } from "@/features/public-content/site";
import { localBusinessJsonLd, pageMetadata, safeHttp } from "@/features/public-content/seo";
import { ArrowStartIcon, GridIcon, IconLink } from "@/components/ui/IconLink";
import { YouTubeIcon } from "@/components/ui/SocialIcons";
import { SITE_TARGETS } from "@/lib/site-targets";
import { bidiDir } from "@/lib/bidi";

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
  stats: "stats-title",
};

export default async function HomePage() {
  const [settings, gallery, services, sections, offers, steps, albums, packages, heroPhoto] = await Promise.all([
    getBusinessSettings(),
    getVideoGallery(),
    getPublishedServices(),
    getSiteSections(),
    getActiveOffers(),
    getProcessSteps(),
    getPublishedAlbums(),
    getPublishedPackages(),
    getSiteHeroPhotoId(),
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
  // Strictly by latest publish (homeAlbums); the owner's stored picks are kept but not mixed in.
  const albumList = albums.status === "ok" ? homeAlbums(albums.data.filter((a) => a.photoCount > 0), cfg("albums").limit) : [];

  // Hero promo: the self-hosted studio promo by default; the owner may switch to a published YouTube promo.
  const ytPromo =
    s?.hero_promo_source === "youtube" && g
      ? (g.videos.find((v) => v.id === s.hero_promo_video_id) ?? g.promo ?? promoVideos(g)[0] ?? null)
      : null;

  const renderSection = (c: SectionConfig, tone: "dark" | "darker") => {
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
                <div className="flex items-center gap-3">
                  {channel ? (
                    <IconLink href={channel} external label="قناتنا على YouTube">
                      <YouTubeIcon size={18} />
                    </IconLink>
                  ) : null}
                  <IconLink href="/work" label="كل الأعمال">
                    <GridIcon />
                  </IconLink>
                </div>
              }
            />
            {gallery.status === "unavailable" ? (
              <p role="status" className="text-ivory-muted">
                تعذّر تحميل الفيديوهات الآن. جرّب مرة أخرى بعد قليل.
              </p>
            ) : (
              <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                {works.map((v, i) => (
                  <li key={v.id} className="h-full">
                    <FadeRise delay={(i % 3) * 80} className="h-full">
                      <YouTubeCard video={{ ...toCardVideo(v, durationLabel(v.duration_seconds)), categories: v.primary ? [v.primary] : [] }} />
                    </FadeRise>
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
                <IconLink href="/services" label="تفاصيل الخدمات">
                  <ArrowStartIcon />
                </IconLink>
              }
            />
            <Reveal onScroll>
              <ol className="divide-y divide-hairline border-y border-hairline">
                {serviceList.map((x, i) => (
                  <li key={x.key} data-reveal>
                    <Link href={x.href} className="group grid items-baseline gap-2 py-6 md:grid-cols-[4rem_1fr_2fr] md:gap-8 md:py-7">
                      <span className="font-display text-sm text-ivory-muted" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-display text-2xl font-semibold transition-colors group-hover:text-gold md:text-3xl">
                        <bdi dir={bidiDir(x.title)}>{x.title}</bdi>
                      </span>
                      {x.summary ? <span className="text-ivory-muted md:text-lg">{x.summary}</span> : null}
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
                  <IconLink href="/offers" label="كل العروض">
                    <GridIcon />
                  </IconLink>
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
                  <IconLink href={SITE_TARGETS.albums.path} label="كل الألبومات">
                    <GridIcon />
                  </IconLink>
                }
              />
              <ul className={`grid gap-x-6 gap-y-10 sm:grid-cols-2 ${albumList.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
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
                  <li key={step.key} data-reveal className="border-t border-hairline-gold pt-5">
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
            </Reveal>
          </Section>
        );
      }
      case "about":
        return (
          <Section key={c.key} tone={tone} labelledBy={hid}>
            <div data-home-section="about" className="max-w-3xl">
              <h2 id={hid} className="text-h2 font-bold tracking-tight">{c.title}</h2>
              <span aria-hidden="true" className="gold-rule mt-4" />
              {c.intro ? <p className="mt-4 text-lg whitespace-pre-line text-ivory-muted">{c.intro}</p> : null}
              <Link href="/about" className={`${linkCls} mt-4`}>
                اعرف عنا أكثر
                <ChevronStart />
              </Link>
            </div>
          </Section>
        );
      case "stats":
        // Owner-entered number only (admin «عدّاد الحفلات»); never rendered without one.
        if (!c.stat) return null;
        return (
          <Section key={c.key} tone={tone} labelledBy={hid}>
            <div data-home-section="stats" className="flex flex-col items-center text-center">
              <h2 id={hid} className="flex flex-col items-center gap-3">
                <span data-stat-value className="font-display text-[clamp(3.5rem,11vw,7.5rem)] font-bold leading-none tracking-tight text-gold" dir="ltr">
                  {c.stat.toLocaleString("en-US")}
                </span>
                <span className="text-h3 font-bold">{c.title}</span>
              </h2>
              <span aria-hidden="true" className="gold-rule mx-auto mt-5" />
              {c.intro ? <p className="mt-5 max-w-2xl whitespace-pre-line text-lg text-ivory-muted">{c.intro}</p> : null}
            </div>
          </Section>
        );
      case "contact":
        return (
          <Section key={c.key} tone={tone} labelledBy={hid}>
            <div data-home-section="contact" className="flex flex-col items-start gap-4">
              <h2 id={hid} className="text-h2 font-bold tracking-tight">{c.title}</h2>
              <span aria-hidden="true" className="gold-rule mt-4" />
              {c.intro ? <p className="max-w-3xl text-lg whitespace-pre-line text-ivory-muted">{c.intro}</p> : null}
              <WhatsAppCta />
            </div>
          </Section>
        );
    }
  };

  // Packages preview (not a CMS section key): a few published packages, featured first; only when some exist.
  const pkgPreview =
    packages.status === "ok"
      ? [...packages.data].sort((a, b) => Number(b.featured) - Number(a.featured) || a.sort_order - b.sort_order).slice(0, 3)
      : [];
  const renderPackages = (tone: "dark" | "darker") => (
    <Section key="packages" tone={tone} labelledBy="packages-title">
      <div data-home-section="packages">
        <SectionHeading
          id="packages-title"
          title="البكجات"
          lead="من باقات خدماتنا للأعراس والمناسبات، والأسعار بالشيكل."
          action={
            <IconLink href="/packages" label="عرض كل البكجات">
              <GridIcon />
            </IconLink>
          }
        />
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {pkgPreview.map((p, i) => (
            <FadeRise as="li" key={p.id} delay={(i % 3) * 80} className="h-full">
              <PackageCard pkg={p} />
            </FadeRise>
          ))}
        </ul>
      </div>
    </Section>
  );

  // Render visible sections in the owner's order (packages preview after services, else after works, else before
  // contact); tones alternate over what is actually shown.
  const slots: (SectionConfig | "packages")[] = sections.filter((c) => c.visible);
  if (pkgPreview.length) {
    const after = ["services", "works"].map((k) => slots.findIndex((x) => x !== "packages" && x.key === k)).find((i) => i >= 0);
    const contactAt = slots.findIndex((x) => x !== "packages" && x.key === "contact");
    slots.splice(after !== undefined ? after + 1 : contactAt >= 0 ? contactAt : slots.length, 0, "packages");
  }
  const rendered: React.ReactNode[] = [];
  for (const c of slots) {
    const tone = rendered.length % 2 ? "darker" : "dark";
    const node = c === "packages" ? renderPackages(tone) : renderSection(c, tone);
    if (node) rendered.push(node);
  }

  return (
    <>
      {s ? <JsonLd data={localBusinessJsonLd(s)} /> : null}
      {ytPromo ? null : <JsonLd data={promoVideoJsonLd()} />}

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
          coverSrc: heroPhoto ? photoUrl(heroPhoto, "display") : null,
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
