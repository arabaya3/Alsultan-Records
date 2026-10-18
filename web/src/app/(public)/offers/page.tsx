import { OfferCard } from "@/components/offers/OfferCard";
import { PageIntro, Section } from "@/components/ui/Layout";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { getActiveOffers } from "@/features/public-content/cms-queries";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "العروض",
  description: "العروض والباقات الحالية من ستوديو وتسجيلات السلطان للأعراس والمناسبات.",
  path: "/offers",
});

export default async function OffersPage() {
  const res = await getActiveOffers();
  return (
    <>
      <PageIntro title="العروض" lead="العروض والباقات المتاحة حالياً. للتفاصيل والأسعار حسب مناسبتك، راسلنا على واتساب." />
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
                  <OfferCard offer={o} />
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
