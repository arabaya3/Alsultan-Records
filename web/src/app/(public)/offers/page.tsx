import { OfferCard } from "@/components/offers/OfferCard";
import { FadeRise } from "@/components/motion/Reveal";
import { ButtonLink } from "@/components/ui/Button";
import { PageHero } from "@/components/ui/PageHero";
import { Section, SectionHeading } from "@/components/ui/Layout";
import { ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { getActiveOffers, getPublishedPackages } from "@/features/public-content/cms-queries";
import { getSiteHeroPhotoId } from "@/features/public-content/gallery-queries";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "العروض",
  description: "العروض المؤقتة الحالية من ستوديو وتسجيلات السلطان للأعراس والمناسبات.",
  path: "/offers",
});

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
    </svg>
  );
}

/** Generic, truthful planning steps (booking happens on WhatsApp only). */
const PLAN = [
  { title: "اختر نوع المناسبة", body: "عرس، خطوبة، سهرة أو أي مناسبة عندك." },
  { title: "حدّد الموعد", body: "خبّرنا بالتاريخ والمكان لنتأكد من التوفر." },
  { title: "تواصل معنا", body: "راسلنا على واتساب ونحكي معك بالتفاصيل." },
] as const;

export default async function OffersPage() {
  const [res, pk, cover] = await Promise.all([getActiveOffers(), getPublishedPackages(), getSiteHeroPhotoId()]);
  // Linked package shown only while it is published; the offer never changes the package.
  const pkgTitle = new Map(pk.status === "ok" ? pk.data.map((p) => [p.id, p.title] as const) : []);
  return (
    <>
      <PageHero
        title={
          <>
            عروض السلطان<span className="text-gold">.</span>
          </>
        }
        lead="عروض لفترة محدودة على مناسباتكم. للباقات الثابتة شوف صفحة البكجات، وللتفاصيل راسلنا على واتساب."
        photoId={cover}
      />
      <Section>
        {res.status === "unavailable" ? (
          <ErrorState title="تعذّر تحميل العروض الآن" action={<WhatsAppCta />} />
        ) : res.data.length === 0 ? (
          <div role="status" className="mx-auto flex max-w-xl flex-col items-center py-6 text-center">
            <span className="grid size-24 place-items-center rounded-full border border-gold/70 text-gold">
              <CalendarIcon />
            </span>
            <p className="mt-8 text-h3 font-bold">
              لا توجد عروض فعّالة حاليًا<span className="text-gold">.</span>
            </p>
            <p className="mt-3 text-lead text-ivory-muted">استعرض البكجات أو تواصل معنا لمعرفة التفاصيل.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <ButtonLink href="/packages">استعرض البكجات</ButtonLink>
              <WhatsAppCta variant="outline" label="تواصل عبر واتساب" />
            </div>
          </div>
        ) : (
          <>
            <h2 className="sr-only">العروض الحالية</h2>
            <ul data-offer-grid className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {res.data.map((o, i) => (
                <FadeRise as="li" key={o.id} delay={(i % 3) * 80} className="h-full">
                  <OfferCard offer={o} packageTitle={o.package_id ? pkgTitle.get(o.package_id) : null} />
                </FadeRise>
              ))}
            </ul>
            <div className="mt-12 flex flex-wrap gap-4">
              <WhatsAppCta />
              <ButtonLink href="/packages" variant="outline">
                استعرض البكجات
              </ButtonLink>
            </div>
          </>
        )}
      </Section>
      <Section tone="ivory" labelledBy="plan-title">
        <SectionHeading id="plan-title" title="خطّط لمناسبتك" align="center" />
        <ol className="grid gap-10 text-center md:grid-cols-3 md:gap-0 md:divide-x md:divide-x-reverse md:divide-tone-line">
          {PLAN.map((s, i) => (
            <li key={s.title} className="px-6">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-gold/15 font-display text-lg font-bold text-tone-accent">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 text-h3 font-bold">{s.title}</h3>
              <p className="mt-2 text-tone-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
