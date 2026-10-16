import Image from "next/image";
import Link from "next/link";
import { PromoPlayer } from "@/components/media/youtube/PromoPlayer";
import { YouTubeCard } from "@/components/media/youtube/YouTubeCard";
import { Reveal } from "@/components/motion/Reveal";
import { MaskReveal } from "@/components/motion/ScrollEffects";
import { JsonLd } from "@/components/ui/JsonLd";
import { Container, Section, SectionHeading } from "@/components/ui/Layout";
import { ServiceStrip } from "@/components/ui/ServiceStrip";
import { WhatsAppLink } from "@/components/ui/WhatsAppCta";
import { bookingHref, telHref } from "@/features/public-content/contact";
import { FALLBACK_SERVICES, HERO, STEPS } from "@/features/public-content/home-content";
import { durationLabel, videoCategoryLabel } from "@/features/public-content/labels";
import { getBusinessSettings, getPublishedServices, getShowcaseVideos } from "@/features/public-content/queries";
import { localBusinessJsonLd, pageMetadata, safeHttp } from "@/features/public-content/seo";

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

export default async function HomePage() {
  const [settings, videos, services] = await Promise.all([getBusinessSettings(), getShowcaseVideos(), getPublishedServices()]);

  const s = settings.status === "ok" ? settings.data : null;
  const book = bookingHref(s);
  const videoList = videos.status === "ok" ? videos.data : [];
  const promo = videoList.find((v) => v.is_promo) ?? null;
  const works = videoList.filter((v) => !v.is_promo).slice(0, 6);
  const channel = safeHttp(s?.youtube_url ?? null);
  const serviceList =
    services.status === "ok" && services.data.length
      ? services.data.map((x) => ({ key: x.id, title: x.title, summary: x.summary, href: `/services/${x.slug}` }))
      : FALLBACK_SERVICES.map((x) => ({ key: x.title, title: x.title, summary: x.summary, href: "/services" }));

  return (
    <>
      {s ? <JsonLd data={localBusinessJsonLd(s)} /> : null}

      {/* HERO: headline + real promo + one primary action, all above the fold at 1440×900. */}
      <section aria-labelledby="hero-title" className="ink-texture relative isolate overflow-hidden text-on-dark">
        <Container className="grid items-center gap-8 py-10 md:py-12 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:py-14">
          <Reveal>
            <h1
              id="hero-title"
              className="text-[2.5rem] font-bold leading-[1.15] tracking-tight sm:text-5xl lg:text-[clamp(3.25rem,4.4vw,4.5rem)]"
            >
              {HERO.title.split(" ").map((w, i, all) => (
                <span key={i} data-reveal className="inline-block">
                  {w}
                  {i < all.length - 1 ? " " : null}
                </span>
              ))}
              <span data-reveal className="inline-block text-gold">
                .
              </span>
            </h1>
            <p data-reveal className="mt-4 text-lg text-on-dark/90 md:text-xl">
              {HERO.sub}
            </p>
            <div data-reveal className="mt-7 flex flex-wrap items-center gap-x-8 gap-y-4">
              {book ? (
                <WhatsAppLink href={book} size="lg" className="min-w-60">
                  {HERO.primary}
                </WhatsAppLink>
              ) : (
                <Link href="/contact" className="inline-flex min-h-14 min-w-60 items-center justify-center rounded-sm bg-gold px-7 text-lg font-medium text-ink">
                  تواصل معنا
                </Link>
              )}
              {videoList.length ? (
                <Link href="/work" className={`${linkCls} text-lg`}>
                  {HERO.secondary}
                </Link>
              ) : null}
            </div>
            <div data-reveal className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
              <ServiceStrip className="text-on-dark" />
              {s?.phone ? (
                <a href={telHref(s.phone)} className={`${linkCls} text-on-dark/90`}>
                  <span className="text-muted">هاتف</span>
                  <span dir="ltr">{s.phone}</span>
                </a>
              ) : null}
            </div>
          </Reveal>

          {promo ? (
            <MaskReveal onLoad>
              <PromoPlayer
                youtubeId={promo.youtube_id}
                title={promo.title}
                caption={HERO.promoCaption}
                duration={durationLabel(promo.duration_seconds)}
              />
            </MaskReveal>
          ) : (
            <div aria-hidden="true" className="relative hidden h-full min-h-72 lg:block">
              <Image
                src="/brand/logo-round.webp"
                alt=""
                width={700}
                height={1244}
                priority
                sizes="30vw"
                className="pointer-events-none absolute inset-y-0 end-0 h-full w-auto select-none opacity-[0.09]"
              />
            </div>
          )}
        </Container>
      </section>

      {/* WORK: published, non-promo YouTube videos */}
      <Section labelledBy="work-title">
        <SectionHeading
          id="work-title"
          title="من أعمالنا"
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
        {videos.status === "unavailable" ? (
          <p role="status" className="text-on-cream-muted">
            تعذّر تحميل الفيديوهات الآن. جرّب مرة أخرى بعد قليل.
          </p>
        ) : works.length === 0 ? (
          <p role="status" className="text-on-cream-muted">
            ننشر مقاطع من أعمالنا هنا قريباً.
          </p>
        ) : (
          <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {works.map((v, i) => (
              <li key={v.id}>
                <MaskReveal index={i % 3}>
                  <YouTubeCard
                    video={{
                      youtubeId: v.youtube_id,
                      title: v.title,
                      duration: durationLabel(v.duration_seconds),
                      meta: videoCategoryLabel(v.category),
                    }}
                  />
                </MaskReveal>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* SERVICES */}
      <Section tone="cream-2" labelledBy="services-title">
        <SectionHeading
          id="services-title"
          title="الخدمات"
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
                  <span className="font-display text-2xl font-semibold transition-colors group-hover:text-gold-press md:text-3xl">{x.title}</span>
                  {x.summary ? <span className="text-on-cream-muted md:text-lg">{x.summary}</span> : null}
                </Link>
              </li>
            ))}
          </ol>
        </Reveal>
      </Section>

      {/* HOW WE WORK — WhatsApp based */}
      <Section labelledBy="steps-title">
        <SectionHeading id="steps-title" title="كيف نشتغل" />
        <Reveal onScroll>
          <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {STEPS.map((step, i) => (
              <li key={step.title} data-reveal className="border-t-2 border-on-cream pt-5">
                <span className="font-display text-sm text-gold-text">{`0${i + 1}`}</span>
                <h3 className="mt-2 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 text-on-cream-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </Section>
    </>
  );
}
