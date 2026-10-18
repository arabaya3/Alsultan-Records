import { MediaFrame } from "@/components/media/MediaFrame";
import { FadeRise } from "@/components/motion/Reveal";
import { ButtonLink } from "@/components/ui/Button";
import { Section, SectionHeading } from "@/components/ui/Layout";
import { PageHero } from "@/components/ui/PageHero";
import { ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { getProcessSteps, getServiceLinks } from "@/features/public-content/cms-queries";
import { photoUrl } from "@/features/public-content/gallery-model";
import { FALLBACK_SERVICES } from "@/features/public-content/home-content";
import { getPublishedServices } from "@/features/public-content/queries";
import { pageMetadata } from "@/features/public-content/seo";
import type { Service } from "@/features/public-content/schema";

export const metadata = pageMetadata({
  title: "الخدمات",
  description: "تصوير فوتوغرافي، أفلام أعراس، DJ وتنسيق صوت للأعراس والمناسبات في جنين والشمال.",
  path: "/services",
});

const num = (i: number) => String(i + 1).padStart(2, "0");

type Row = {
  key: string;
  title: string;
  summary: string | null;
  href: string | null;
  media: React.ReactNode;
  photos: boolean;
  videos: boolean;
};

function ServiceMedia({ s }: { s: Service }) {
  if (s.coverPhotoSrc) {
    return (
      <span className="relative block aspect-video bg-night-deep">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={s.coverPhotoSrc} alt="" loading="lazy" decoding="async" data-service-cover className="absolute inset-0 size-full object-contain" />
      </span>
    );
  }
  if (s.cover) return <MediaFrame media={s.cover} alt={s.title} ratio="16/9" />;
  return null;
}

export default async function ServicesPage() {
  const [services, links, steps] = await Promise.all([getPublishedServices(), getServiceLinks(), getProcessSteps()]);
  const list = services.status === "ok" ? services.data : [];
  const rows: Row[] = list.length
    ? list.map((s) => {
        const mine = links.filter((l) => l.service_id === s.id);
        return {
          key: s.id,
          title: s.title,
          summary: s.summary,
          href: `/services/${s.slug}`,
          media: s.coverPhotoSrc || s.cover ? <ServiceMedia s={s} /> : null,
          photos: mine.some((l) => l.kind === "album"),
          videos: mine.some((l) => l.kind === "video"),
        };
      })
    : FALLBACK_SERVICES.map((s) => ({ key: s.title, title: s.title, summary: s.summary, href: null, media: null, photos: false, videos: false }));

  return (
    <>
      <PageHero
        title={
          <>
            الخدمات<span className="text-gold">.</span>
          </>
        }
        lead="نشتغل على المناسبة كاملة: الصورة والفيلم والصوت."
      />
      <Section>
        {services.status === "unavailable" ? (
          <div className="mb-10">
            <ErrorState body="تعذّر تحميل تفاصيل الخدمات الآن. هذه لمحة عامة عمّا نقدّمه." />
          </div>
        ) : null}
        <ol className="space-y-16 md:space-y-24">
          {rows.map((r, i) => (
            <FadeRise as="li" key={r.key} data={{ "data-service-row": r.key }}>
              <div className={`grid items-center gap-8 ${r.media ? "md:grid-cols-2 md:gap-12 lg:gap-16" : ""}`}>
                <div className={`min-w-0 ${r.media && i % 2 ? "md:order-2" : ""}`}>
                  <p className="flex items-center gap-3 font-display text-sm font-semibold text-gold" aria-hidden="true">
                    <span className="h-px w-10 bg-gold" />
                    {num(i)}
                  </p>
                  <h2 className="mt-3 text-h2 font-bold tracking-tight">
                    <bdi>{r.title}</bdi>
                  </h2>
                  {r.summary ? <p className="mt-4 max-w-xl text-lead text-ivory-muted">{r.summary}</p> : null}
                  <div className="mt-7 flex flex-wrap gap-3">
                    {r.href ? <ButtonLink href={r.href}>التفاصيل</ButtonLink> : null}
                    {r.photos ? (
                      <ButtonLink href="/work?tab=photos" variant="outline">
                        شاهد الصور
                      </ButtonLink>
                    ) : null}
                    {r.videos ? (
                      <ButtonLink href="/work" variant="outline">
                        شاهد الفيديوهات
                      </ButtonLink>
                    ) : null}
                    <ButtonLink href="/packages" variant="outline">
                      البكجات
                    </ButtonLink>
                  </div>
                </div>
                {r.media ? (
                  <div className={`min-w-0 overflow-hidden rounded-lg border border-hairline-gold ${i % 2 ? "md:order-1" : ""}`}>{r.media}</div>
                ) : null}
              </div>
            </FadeRise>
          ))}
        </ol>
        <div className="mt-16">
          <WhatsAppCta />
        </div>
      </Section>
      {steps.length ? (
        <Section tone="ivory" labelledBy="services-steps-title">
          <SectionHeading
            id="services-steps-title"
            title={
              <>
                كيف نشتغل<span className="text-tone-accent">؟</span>
              </>
            }
            align="center"
          />
          <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {steps.map((step, i) => (
              <li key={step.key} className="text-center">
                {step.photoId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl(step.photoId, "thumb")} alt="" loading="lazy" decoding="async" className="mb-4 aspect-[4/3] w-full rounded-sm bg-night-deep object-contain" />
                ) : null}
                <span className="mx-auto grid size-14 place-items-center rounded-full border border-gold font-display text-lg font-bold text-tone-accent">
                  {num(i)}
                </span>
                <h3 className="mt-4 text-xl font-bold break-words">{step.title}</h3>
                {step.body ? <p className="mt-2 text-tone-muted">{step.body}</p> : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
    </>
  );
}
