import Image from "next/image";
import Link from "next/link";
import { PlaceholderMedia, showPlaceholders } from "@/components/media/Placeholder";
import { ProjectTile } from "@/components/media/ProjectTile";
import { Reveal } from "@/components/motion/Reveal";
import { MaskReveal, Parallax } from "@/components/motion/ScrollEffects";
import { ButtonLink, PlayBadge } from "@/components/ui/Button";
import { JsonLd } from "@/components/ui/JsonLd";
import { Container, Section, SectionHeading } from "@/components/ui/Layout";
import { ServiceStrip } from "@/components/ui/ServiceStrip";
import { FALLBACK_SERVICES, HERO, STEPS } from "@/features/public-content/home-content";
import { eventTypeLabel } from "@/features/public-content/labels";
import {
  getApprovedReviews,
  getBusinessSettings,
  getHeroMedia,
  getPublishedProjects,
  getPublishedServices,
} from "@/features/public-content/queries";
import { localBusinessJsonLd, pageMetadata } from "@/features/public-content/seo";

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

export default async function HomePage() {
  const [settings, hero, projects, services, reviews] = await Promise.all([
    getBusinessSettings(),
    getHeroMedia(),
    getPublishedProjects(4),
    getPublishedServices(),
    getApprovedReviews(3),
  ]);

  const projectList = projects.status === "ok" ? projects.data : [];
  const serviceList =
    services.status === "ok" && services.data.length
      ? services.data.map((s) => ({ key: s.id, title: s.title, summary: s.summary, href: `/services/${s.slug}` }))
      : FALLBACK_SERVICES.map((s) => ({ key: s.title, title: s.title, summary: s.summary, href: "/services" }));
  const reviewList = reviews.status === "ok" ? reviews.data : [];
  const heroStill = hero ? (hero.kind === "image" ? hero.src : hero.poster) : null;

  return (
    <>
      {settings.status === "ok" && settings.data ? <JsonLd data={localBusinessJsonLd(settings.data)} /> : null}

      {/* HERO */}
      <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-ink text-on-dark">
        <div className="absolute inset-0 -z-10">
          {heroStill ? (
            <Parallax className="absolute -inset-y-[8%] inset-x-0">
              <Image src={heroStill} alt="" fill priority sizes="100vw" unoptimized className="object-cover" />
            </Parallax>
          ) : showPlaceholders ? (
            <div className="absolute inset-y-0 start-[38%] end-0 max-md:start-0">
              <PlaceholderMedia />
            </div>
          ) : null}
          {/* Scrim: darkest on the text (right) side, clearing toward the left. */}
          <div className="absolute inset-0 bg-linear-to-r from-transparent via-black/45 to-black/90 max-md:bg-linear-to-t max-md:from-black/95 max-md:via-black/70 max-md:to-black/20" />
        </div>

        <Container className="flex min-h-[560px] flex-col justify-end pb-10 pt-40 md:min-h-[600px] md:justify-center md:pb-12 md:pt-20 lg:min-h-[540px]">
          <Reveal className="max-w-[46rem]">
            <h1 id="hero-title" data-reveal className="text-[2.75rem] font-bold leading-[1.15] tracking-tight sm:text-6xl lg:whitespace-nowrap lg:text-[4.75rem]">
              {HERO.title}
              <span className="text-gold">.</span>
            </h1>
            <p data-reveal className="mt-5 text-lg text-on-dark/90 md:text-2xl">
              {HERO.sub}
            </p>
            <div data-reveal className="mt-9 flex flex-col items-start gap-5">
              <ButtonLink href="/work" size="lg" className="min-w-60 justify-between">
                <span>{HERO.primary}</span>
                <PlayBadge size={34} className="border-ink bg-ink text-gold" />
              </ButtonLink>
              <ButtonLink href="/book" variant="link" tone="dark" className="text-lg">
                {HERO.secondary}
              </ButtonLink>
            </div>
          </Reveal>
          <ServiceStrip className="mt-12 text-on-dark md:mt-16" />
        </Container>
      </section>

      {/* SHOWCASE — real published projects only; placeholders in development */}
      {projectList.length > 0 || showPlaceholders ? (
        <Section labelledBy="work-title">
          <SectionHeading
            id="work-title"
            title="من أعمالنا"
            action={
              <Link href="/work" className="inline-flex min-h-11 items-center gap-2 underline decoration-1 underline-offset-8 hover:decoration-gold">
                كل الأعمال
                <ChevronStart />
              </Link>
            }
          />
          <div className="grid gap-6 md:grid-cols-2">
            {projectList.length > 0
              ? projectList.map((p, i) => (
                  <MaskReveal key={p.id} index={i % 2}>
                    <ProjectTile
                      href={`/work/${p.public_slug}`}
                      title={p.title}
                      meta={[eventTypeLabel(p.event_type), p.city].filter(Boolean).join(" · ") || null}
                      media={p.cover}
                      priority={i < 2}
                    />
                  </MaskReveal>
                ))
              : ["أفراح ومناسبات", "أفلام الزفاف"].map((label, i) => (
                  <MaskReveal key={label} index={i}>
                    <ProjectTile href="/work" title={label} media={null} />
                  </MaskReveal>
                ))}
          </div>
          {projects.status === "unavailable" && showPlaceholders ? (
            <p className="mt-4 text-sm text-on-cream-muted">(بيئة التطوير: تعذّر الاتصال بقاعدة البيانات، تُعرض عناصر مؤقتة.)</p>
          ) : null}
        </Section>
      ) : null}

      {/* SERVICES */}
      <Section tone="cream-2" labelledBy="services-title">
        <SectionHeading
          id="services-title"
          title="الخدمات"
          action={
            <Link href="/services" className="inline-flex min-h-11 items-center gap-2 underline decoration-1 underline-offset-8 hover:decoration-gold">
              تفاصيل الخدمات
              <ChevronStart />
            </Link>
          }
        />
        <Reveal onScroll>
          <ol className="divide-y divide-cream-line border-y border-cream-line">
            {serviceList.map((s, i) => (
              <li key={s.key} data-reveal>
                <Link href={s.href} className="group grid items-baseline gap-2 py-6 md:grid-cols-[4rem_1fr_2fr] md:gap-8 md:py-8">
                  <span className="font-display text-sm text-on-cream-muted" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-display text-2xl font-semibold transition-colors group-hover:text-gold-press md:text-3xl">{s.title}</span>
                  {s.summary ? <span className="text-on-cream-muted md:text-lg">{s.summary}</span> : null}
                </Link>
              </li>
            ))}
          </ol>
        </Reveal>
      </Section>

      {/* HOW WE WORK */}
      <Section labelledBy="steps-title">
        <SectionHeading id="steps-title" title="كيف نشتغل" />
        <Reveal onScroll>
          <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {STEPS.map((step, i) => (
              <li key={step.title} data-reveal className="border-t-2 border-on-cream pt-5">
                <span className="font-display text-sm text-gold-press">{`0${i + 1}`}</span>
                <h3 className="mt-2 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 text-on-cream-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </Section>

      {/* REVIEWS — only approved ones, only if any exist */}
      {reviewList.length > 0 ? (
        <Section tone="cream-2" labelledBy="reviews-title">
          <SectionHeading id="reviews-title" title="من كلام عملائنا" />
          <ul className="grid gap-8 md:grid-cols-3">
            {reviewList.map((r) => (
              <li key={r.id}>
                <figure>
                  <p className="text-gold-press" aria-label={`التقييم ${r.rating} من 5`}>
                    {"★".repeat(r.rating)}
                  </p>
                  <blockquote className="mt-3 text-lg leading-relaxed">{r.body}</blockquote>
                  {r.display_name ? <figcaption className="mt-3 text-on-cream-muted">— {r.display_name}</figcaption> : null}
                </figure>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* BOOKING CTA */}
      <section aria-labelledby="cta-title" className="bg-ink text-on-dark">
        <Container className="flex flex-col items-start justify-between gap-8 py-16 md:flex-row md:items-center md:py-20">
          <div>
            <h2 id="cta-title" className="text-3xl font-bold md:text-5xl">
              عندك مناسبة قريبة<span className="text-gold">؟</span>
            </h2>
            <p className="mt-3 text-lg text-muted">احكِ لنا التفاصيل الأساسية، ونرجع لك لنتفق على الباقي.</p>
          </div>
          <ButtonLink href="/book" size="lg" className="min-w-56">
            احجز مناسبتك
          </ButtonLink>
        </Container>
      </section>
    </>
  );
}
