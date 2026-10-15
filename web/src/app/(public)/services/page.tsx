import Link from "next/link";
import { MediaFrame } from "@/components/media/MediaFrame";
import { ButtonLink } from "@/components/ui/Button";
import { PageIntro, Section } from "@/components/ui/Layout";
import { ErrorState } from "@/components/ui/States";
import { FALLBACK_SERVICES } from "@/features/public-content/home-content";
import { getPublishedServices } from "@/features/public-content/queries";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "الخدمات",
  description: "تصوير فوتوغرافي، أفلام أعراس، DJ وتنسيق صوت للأعراس والمناسبات في جنين والشمال.",
  path: "/services",
});

export default async function ServicesPage() {
  const services = await getPublishedServices();
  const list = services.status === "ok" ? services.data : [];
  return (
    <>
      <PageIntro title="الخدمات" lead="نشتغل على المناسبة كاملة: الصورة والفيلم والصوت." />
      <Section>
        {services.status === "unavailable" ? (
          <div className="mb-10">
            <ErrorState body="تعذّر تحميل تفاصيل الخدمات الآن. هذه لمحة عامة عمّا نقدّمه." />
          </div>
        ) : null}
        {list.length ? (
          <ul className="divide-y divide-cream-line border-y border-cream-line">
            {list.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/services/${s.slug}`}
                  className="group grid items-center gap-6 py-8 md:grid-cols-[1fr_1.2fr] md:gap-12"
                >
                  <div>
                    <h2 className="text-3xl font-semibold transition-colors group-hover:text-gold-press">{s.title}</h2>
                    {s.summary ? <p className="mt-3 text-lg text-on-cream-muted">{s.summary}</p> : null}
                    <span className="mt-4 inline-block underline decoration-1 underline-offset-8 group-hover:decoration-gold">
                      التفاصيل
                    </span>
                  </div>
                  {s.cover ? <MediaFrame media={s.cover} alt={s.title} ratio="16/9" /> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-cream-line border-y border-cream-line">
            {FALLBACK_SERVICES.map((s) => (
              <li key={s.title} className="grid gap-2 py-8 md:grid-cols-[1fr_2fr] md:gap-12">
                <h2 className="text-3xl font-semibold">{s.title}</h2>
                <p className="text-lg text-on-cream-muted">{s.summary}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-12">
          <ButtonLink href="/book">احجز مناسبتك</ButtonLink>
        </div>
      </Section>
    </>
  );
}
