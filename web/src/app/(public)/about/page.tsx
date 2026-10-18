import { ContactBand } from "@/components/home/ContactBand";
import { SitePromoPlayer } from "@/components/media/promo/SitePromoPlayer";
import { PROMO_CAPTION } from "@/components/media/promo/promo-seo";
import { FadeRise } from "@/components/motion/Reveal";
import { ButtonLink } from "@/components/ui/Button";
import { Section, SectionHeading } from "@/components/ui/Layout";
import { PageHero } from "@/components/ui/PageHero";
import { ServiceStrip } from "@/components/ui/ServiceStrip";
import { photoUrl } from "@/features/public-content/gallery-model";
import { getBusinessSettings } from "@/features/public-content/queries";
import { pageMetadata } from "@/features/public-content/seo";
import { SITE_NAME_AR } from "@/features/public-content/site";

export const metadata = pageMetadata({
  title: "من نحن",
  description: "ستوديو وتسجيلات السلطان من ميثلون – جنين: تصوير وأفلام أعراس ومناسبات وDJ.",
  path: "/about",
});

// Copy is intentionally modest and factual; the owner should review and extend it.
const ABOUT = [
  "نحن ستوديو تصوير وتسجيلات نشتغل على الأعراس والخطوبات والمناسبات. نوثّق اليوم بالصورة والفيديو، ونرافق السهرة بالصوت والـDJ.",
  "نحب أن نفهم مناسبتك قبل يومها: مين أهم الناس، شو اللحظات اللي ما بدك تفوتك، وكيف بدك تتذكر اليوم. وعلى هذا الأساس نرتّب التغطية.",
  "نخدم العرسان والعائلات وكل من عنده مناسبة، ومن خدماتنا أيضاً جلسات تصوير مخصصة للنساء بطاقم مناسب لذلك عند الطلب.",
] as const;

export default async function AboutPage() {
  const settings = await getBusinessSettings();
  const s = settings.status === "ok" ? settings.data : null;
  return (
    <>
      <PageHero
        align="start"
        title={
          <>
            من نحن<span className="text-gold">.</span>
          </>
        }
        eyebrow={SITE_NAME_AR}
        lead="ستوديو وتسجيلات السلطان، من ميثلون – جنين."
        photoId={s?.hero_cover_photo_id ?? null}
      />
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
          <div className="max-w-2xl space-y-5 text-lg leading-loose">
            {ABOUT.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
          <aside className="self-start rounded-lg border border-hairline-gold bg-surface p-6 md:p-8">
            <h2 className="text-xl font-semibold">ما نقدّمه</h2>
            <span aria-hidden="true" className="gold-rule mt-3" />
            <ServiceStrip className="mt-5" />
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href="/work">شاهد أعمالنا</ButtonLink>
              <ButtonLink href="/services" variant="outline">
                الخدمات
              </ButtonLink>
            </div>
          </aside>
        </div>
      </Section>
      <Section tone="darker" labelledBy="about-promo-title">
        <SectionHeading id="about-promo-title" title="شاهد التعريف بالسلطان" align="center" />
        <FadeRise className="mx-auto max-w-4xl overflow-hidden rounded-lg border border-hairline-gold">
          <SitePromoPlayer
            caption={PROMO_CAPTION}
            sizes="(min-width: 1024px) 896px, 100vw"
            coverSrc={s?.hero_cover_photo_id ? photoUrl(s.hero_cover_photo_id, "display") : null}
          />
        </FadeRise>
      </Section>
      <ContactBand settings={s} />
    </>
  );
}
