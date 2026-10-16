import Link from "next/link";
import { HeroIntro } from "@/components/home/HeroIntro";
import { YouTubeCard } from "@/components/media/youtube/YouTubeCard";
import { Reveal } from "@/components/motion/Reveal";
import { MaskReveal } from "@/components/motion/ScrollEffects";
import { JsonLd } from "@/components/ui/JsonLd";
import { Section, SectionHeading } from "@/components/ui/Layout";
import { bookingHref, telHref } from "@/features/public-content/contact";
import { FALLBACK_SERVICES, HERO, STEPS } from "@/features/public-content/home-content";
import { homeSelection, toCardVideo } from "@/features/public-content/gallery-model";
import { getVideoGallery } from "@/features/public-content/gallery-queries";
import { durationLabel } from "@/features/public-content/labels";
import { getBusinessSettings, getPublishedServices } from "@/features/public-content/queries";
import { CORE_SERVICES, SITE_NAME_AR } from "@/features/public-content/site";
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

const INTRO_ARM_SCRIPT = `try{if(matchMedia("(prefers-reduced-motion: no-preference)").matches)document.documentElement.classList.add("intro-armed")}catch(e){}`;

const linkCls = "inline-flex min-h-11 items-center gap-2 underline decoration-1 underline-offset-8 hover:decoration-gold";

export default async function HomePage() {
  const [settings, gallery, services] = await Promise.all([getBusinessSettings(), getVideoGallery(), getPublishedServices()]);

  const s = settings.status === "ok" ? settings.data : null;
  const book = bookingHref(s);
  const g = gallery.status === "ok" ? gallery.data : null;
  const promo = g?.promo ?? null;
  const works = g ? homeSelection(g, 6) : [];
  const channel = safeHttp(s?.youtube_url ?? null);
  const serviceList =
    services.status === "ok" && services.data.length
      ? services.data.map((x) => ({ key: x.id, title: x.title, summary: x.summary, href: `/services/${x.slug}` }))
      : FALLBACK_SERVICES.map((x) => ({ key: x.title, title: x.title, summary: x.summary, href: "/services" }));

  return (
    <>
      {s ? <JsonLd data={localBusinessJsonLd(s)} /> : null}

      {/* Inline, before the hero markup: arms the intro for the first paint (motion allowed only). */}
      <script dangerouslySetInnerHTML={{ __html: INTRO_ARM_SCRIPT }} />
      <HeroIntro
        brand={SITE_NAME_AR}
        title={HERO.title}
        sub={HERO.sub}
        services={CORE_SERVICES}
        workHref={g && g.videos.length ? "/work" : null}
        whatsappHref={book}
        phone={s?.phone ? { label: s.phone, href: telHref(s.phone) } : null}
        promo={
          promo
            ? { youtubeId: promo.youtube_id, title: promo.title, caption: HERO.promoCaption, duration: durationLabel(promo.duration_seconds) }
            : null
        }
        strip={works.slice(0, 4).map((v) => ({ youtubeId: v.youtube_id, title: v.title }))}
      />

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
        {gallery.status === "unavailable" ? (
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
              <li key={v.id} className="h-full">
                <MaskReveal index={i % 3} className="h-full">
                  <YouTubeCard video={{ ...toCardVideo(v, durationLabel(v.duration_seconds)), categories: v.primary ? [v.primary] : [] }} />
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
