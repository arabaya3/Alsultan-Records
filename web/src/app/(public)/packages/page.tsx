import { PackageCard } from "@/components/packages/PackageCard";
import { FadeRise } from "@/components/motion/Reveal";
import { PageHero } from "@/components/ui/PageHero";
import { Container, Section } from "@/components/ui/Layout";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { getPublishedPackages } from "@/features/public-content/cms-queries";
import { groupPackages } from "@/features/public-content/cms-model";
import { getBusinessSettings } from "@/features/public-content/queries";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "البكجات",
  description: "باقات خدمات ستوديو وتسجيلات السلطان للأعراس والمناسبات: تصوير، أفلام، وDJ.",
  path: "/packages",
});

export default async function PackagesPage() {
  const [res, settings] = await Promise.all([getPublishedPackages(), getBusinessSettings()]);
  const cover = settings.status === "ok" ? (settings.data?.hero_cover_photo_id ?? null) : null;
  const groups = res.status === "ok" ? groupPackages(res.data) : [];
  const labelled = groups.filter((g) => g.label);
  return (
    <>
      <PageHero
        eyebrow={<span aria-hidden="true">البكجات</span>}
        title={
          <>
            <span className="sr-only">البكجات: </span>بكج يناسب مناسبتك<span className="text-gold">.</span>
          </>
        }
        lead="خدمات واضحة وأسعار بالشيكل. للعروض المؤقتة شوف صفحة العروض، وللتفاصيل حسب مناسبتك راسلنا على واتساب."
        photoId={cover}
      />
      {labelled.length > 1 ? (
        <nav aria-label="مجموعات البكجات" className="sticky top-0 z-20 border-b border-hairline bg-night/90 backdrop-blur">
          <Container>
            <ul className="-mx-1 flex gap-2 overflow-x-auto py-3 [scrollbar-width:none]">
              {groups.map((g, gi) =>
                g.label ? (
                  <li key={g.label} className="shrink-0">
                    <a
                      href={`#pkg-group-${gi}`}
                      data-package-chip={g.label}
                      className="inline-flex min-h-11 items-center rounded-sm border border-hairline-gold px-5 text-sm font-medium whitespace-nowrap transition-colors hover:border-gold hover:bg-gold hover:text-ink"
                    >
                      {g.label}
                    </a>
                  </li>
                ) : null,
              )}
            </ul>
          </Container>
        </nav>
      ) : null}
      <Section>
        {res.status === "unavailable" ? (
          <ErrorState title="تعذّر تحميل البكجات الآن" action={<WhatsAppCta />} />
        ) : res.data.length === 0 ? (
          <EmptyState
            title="لا توجد بكجات منشورة حالياً"
            body="راسلنا على واتساب ونحكي معك عن مناسبتك والخدمات اللي بتناسبك."
            action={<WhatsAppCta />}
          />
        ) : (
          <div className="space-y-20">
            {groups.map((g, gi) => (
              <section
                key={g.label ?? `other-${gi}`}
                id={`pkg-group-${gi}`}
                data-package-group={g.label ?? ""}
                aria-labelledby={`pkg-group-${gi}-title`}
                className="scroll-mt-24"
              >
                {g.label ? (
                  <div className="mb-8">
                    <h2 id={`pkg-group-${gi}-title`} className="text-h2 font-bold tracking-tight">
                      {g.label}
                      <span className="text-gold">.</span>
                    </h2>
                    <span aria-hidden="true" className="gold-rule mt-4" />
                  </div>
                ) : (
                  <h2 id={`pkg-group-${gi}-title`} className="sr-only">
                    بكجات أخرى
                  </h2>
                )}
                <ul data-package-grid className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((p, i) => (
                    <FadeRise as="li" key={p.id} delay={(i % 3) * 80} className="h-full">
                      <PackageCard pkg={p} />
                    </FadeRise>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
