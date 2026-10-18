import { PackageCard } from "@/components/packages/PackageCard";
import { PageIntro, Section } from "@/components/ui/Layout";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { getPublishedPackages } from "@/features/public-content/cms-queries";
import { groupPackages } from "@/features/public-content/cms-model";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "البكجات",
  description: "باقات خدمات ستوديو وتسجيلات السلطان للأعراس والمناسبات: تصوير، أفلام، وDJ.",
  path: "/packages",
});

export default async function PackagesPage() {
  const res = await getPublishedPackages();
  return (
    <>
      <PageIntro title="البكجات" lead="باقات خدماتنا الثابتة. للعروض المؤقتة شوف صفحة العروض، وللتفاصيل حسب مناسبتك راسلنا على واتساب." />
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
          <div className="space-y-16">
            {groupPackages(res.data).map((g, gi) => (
              <section key={g.label ?? `other-${gi}`} data-package-group={g.label ?? ""} aria-labelledby={`pkg-group-${gi}`}>
                <h2 id={`pkg-group-${gi}`} className={g.label ? "mb-6 text-2xl font-bold md:text-3xl" : "sr-only"}>
                  {g.label ?? "بكجات أخرى"}
                </h2>
                <ul data-package-grid className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((p) => (
                    <li key={p.id} className="h-full">
                      <PackageCard pkg={p} />
                    </li>
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
