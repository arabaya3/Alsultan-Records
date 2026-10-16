import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { ButtonLink } from "@/components/ui/Button";
import { PageIntro, Section } from "@/components/ui/Layout";
import { ServiceStrip } from "@/components/ui/ServiceStrip";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "من نحن",
  description: "ستوديو وتسجيلات السلطان من ميثلون – جنين: تصوير وأفلام أعراس ومناسبات وDJ.",
  path: "/about",
});

// Copy is intentionally modest and factual; the owner should review and extend it.
export default function AboutPage() {
  return (
    <>
      <PageIntro title="من نحن" lead="ستوديو وتسجيلات السلطان، من ميثلون – جنين." />
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr]">
          <div className="max-w-2xl space-y-5 text-lg leading-loose">
            <p>
              نحن ستوديو تصوير وتسجيلات نشتغل على الأعراس والخطوبات والمناسبات. نوثّق اليوم بالصورة
              والفيديو، ونرافق السهرة بالصوت والـDJ.
            </p>
            <p>
              نحب أن نفهم مناسبتك قبل يومها: مين أهم الناس، شو اللحظات اللي ما بدك تفوتك، وكيف بدك
              تتذكر اليوم. وعلى هذا الأساس نرتّب التغطية.
            </p>
            <p>
              نخدم العرسان والعائلات وكل من عنده مناسبة، ومن خدماتنا أيضاً جلسات تصوير مخصصة للنساء
              بطاقم مناسب لذلك عند الطلب.
            </p>
          </div>
          <aside className="self-start border-t-2 border-on-cream pt-6">
            <h2 className="text-xl font-semibold">ما نقدّمه</h2>
            <ServiceStrip className="mt-4" />
            <div className="mt-8 flex flex-col items-start gap-4">
              <WhatsAppCta />
              <ButtonLink href="/work" variant="link" tone="light">
                شاهد أعمالنا
              </ButtonLink>
            </div>
          </aside>
        </div>
      </Section>
    </>
  );
}
