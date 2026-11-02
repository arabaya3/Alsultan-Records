import { ContactBand } from "@/components/home/ContactBand";
import { ButtonLink } from "@/components/ui/Button";
import { Section } from "@/components/ui/Layout";
import { PageHero } from "@/components/ui/PageHero";
import { ServiceStrip } from "@/components/ui/ServiceStrip";
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
      <ContactBand settings={s} />
    </>
  );
}
