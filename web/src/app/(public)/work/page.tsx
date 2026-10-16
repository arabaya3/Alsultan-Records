import { ProjectTile } from "@/components/media/ProjectTile";
import { MaskReveal } from "@/components/motion/ScrollEffects";
import { ButtonLink } from "@/components/ui/Button";
import { PageIntro, Section } from "@/components/ui/Layout";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { eventTypeLabel, formatDateAr } from "@/features/public-content/labels";
import { getPublishedProjects } from "@/features/public-content/queries";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "أعمالنا",
  description: "مختارات من أعراس ومناسبات وثّقها ستوديو وتسجيلات السلطان، منشورة بموافقة أصحابها.",
  path: "/work",
});

export default async function WorkPage() {
  const projects = await getPublishedProjects();
  return (
    <>
      <PageIntro title="أعمالنا" lead="مناسبات وثّقناها، ننشرها بموافقة أصحابها." />
      <Section>
        {projects.status === "unavailable" ? (
          <ErrorState action={<ButtonLink href="/contact">تواصل معنا</ButtonLink>} />
        ) : projects.data.length === 0 ? (
          <EmptyState
            title="نجهّز معرض الأعمال"
            body="ننشر الأعمال بعد موافقة أصحابها. إلى ذلك الحين، يسعدنا أن نحكي معك عن مناسبتك."
            action={
              <div className="flex flex-wrap items-center justify-center gap-6">
                <ButtonLink href="/book">احجز مناسبتك</ButtonLink>
                <ButtonLink href="/contact" variant="link" tone="light">
                  تواصل معنا
                </ButtonLink>
              </div>
            }
          />
        ) : (
          <ul className="grid gap-6 md:grid-cols-2">
            {projects.data.map((p, i) => (
              <li key={p.id}>
                <MaskReveal index={i % 2}>
                  <ProjectTile
                    href={`/work/${p.public_slug}`}
                    title={p.title}
                    meta={
                      [eventTypeLabel(p.event_type), p.city, formatDateAr(p.event_date)]
                        .filter(Boolean)
                        .join(" · ") || null
                    }
                    media={p.cover}
                    priority={i < 2}
                    ratioClassName="aspect-[4/3]"
                  />
                </MaskReveal>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
