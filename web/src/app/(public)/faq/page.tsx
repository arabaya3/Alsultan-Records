import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { ButtonLink } from "@/components/ui/Button";
import { JsonLd } from "@/components/ui/JsonLd";
import { PageIntro, Section } from "@/components/ui/Layout";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "أسئلة شائعة",
  description: "إجابات عن الحجز عبر واتساب والتسليم لدى ستوديو وتسجيلات السلطان.",
  path: "/faq",
});

// Answers describe the site's actual process; owner should review wording and policies.
const FAQ = [
  {
    q: "كيف أحجز؟",
    a: "راسلنا على واتساب واكتب نوع المناسبة وتاريخها ومكانها والخدمات اللي بتحتاجها، أو اتصل بنا.",
  },
  {
    q: "هل الرسالة تعني أن الموعد محجوز؟",
    a: "لا. نتواصل معك لنتأكد من توفر الموعد ونتفق على التفاصيل، ويُثبَّت الحجز بعد الاتفاق.",
  },
  {
    q: "كيف أستلم الصور والفيديو؟",
    a: "نتفق معك على طريقة وموعد التسليم عند الحجز.",
  },
  {
    q: "هل تنشرون صور مناسبتي؟",
    a: "لا ننشر أي مناسبة إلا بموافقة أصحابها، ويمكن سحب الموافقة لاحقاً.",
  },
  {
    q: "هل تغطّون مناسبات خارج جنين؟",
    a: "اذكر المدينة والمكان في رسالتك، ونرد عليك بما يناسب.",
  },
];

export default function FaqPage() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }}
      />
      <PageIntro title="أسئلة شائعة" />
      <Section>
        <div className="max-w-3xl divide-y divide-cream-line border-y border-cream-line">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-2">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-semibold md:text-xl">
                {f.q}
                <span aria-hidden="true" className="text-2xl text-gold-press transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="pb-5 text-lg text-on-cream-muted">{f.a}</p>
            </details>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center gap-6">
          <WhatsAppCta />
          <ButtonLink href="/contact" variant="link" tone="light">
            سؤالك مش هون؟ تواصل معنا
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
