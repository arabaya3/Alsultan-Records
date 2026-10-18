import { OfferCard } from "@/components/offers/OfferCard";
import { PageIntro, Section } from "@/components/ui/Layout";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { getActiveOffers, getPublishedPackages } from "@/features/public-content/cms-queries";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "العروض",
  description: "العروض المؤقتة الحالية من ستوديو وتسجيلات السلطان للأعراس والمناسبات.",
  path: "/offers",
});

export default async function OffersPage() {
  const [res, pk] = await Promise.all([getActiveOffers(), getPublishedPackages()]);
  // Linked package shown only while it is published; the offer never changes the package.
  const pkgTitle = new Map(pk.status === "ok" ? pk.data.map((p) => [p.id, p.title] as const) : []);
  return (
    <>
      <PageIntro title="العروض" lead="عروض لفترة محدودة. للباقات الثابتة شوف صفحة البكجات، وللتفاصيل والأسعار حسب مناسبتك، راسلنا على واتساب." />
      <Section>
        {res.status === "unavailable" ? (
          <ErrorState title="تعذّر تحميل العروض الآن" action={<WhatsAppCta />} />
        ) : res.data.length === 0 ? (
          <EmptyState
            title="لا توجد عروض حالياً"
            body="ما في عروض منشورة هلّق. راسلنا على واتساب ونحكي معك عن مناسبتك والتفاصيل اللي بتناسبك."
            action={<WhatsAppCta />}
          />
        ) : (
          <>
            <h2 className="sr-only">العروض الحالية</h2>
            <ul data-offer-grid className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {res.data.map((o) => (
                <li key={o.id} className="h-full">
                  <OfferCard offer={o} packageTitle={o.package_id ? pkgTitle.get(o.package_id) : null} />
                </li>
              ))}
            </ul>
            <div className="mt-12">
              <WhatsAppCta />
            </div>
          </>
        )}
      </Section>
    </>
  );
}
