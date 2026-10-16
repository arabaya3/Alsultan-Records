import { PageIntro, Section } from "@/components/ui/Layout";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "الشروط والأحكام",
  description: "الشروط العامة لاستخدام موقع ستوديو وتسجيلات السلطان وطلبات الحجز.",
  path: "/terms",
});

/*
 * LEGAL DRAFT — PENDING LOCAL LEGAL REVIEW.
 * Not reviewed by a lawyer. Commercial terms (deposits, cancellations, delivery times) are
 * deliberately NOT stated here — they belong in each signed contract. The owner must have this
 * page reviewed before launch. Tracked in docs/public-site-notes.md ("Legal pages").
 */
export default function TermsPage() {
  return (
    <>
      <PageIntro title="الشروط والأحكام" />
      <Section>
        <div className="prose-ar max-w-3xl text-lg leading-loose">
          <h2>طلبات الحجز</h2>
          <p>
            إرسال طلب عبر الموقع هو استفسار وليس حجزاً مؤكداً. يُثبَّت الحجز فقط بعد الاتفاق على التفاصيل
            واعتماد العقد.
          </p>
          <h2>العروض والعقود</h2>
          <p>
            الأسعار والدفعات ومواعيد التسليم وشروط الإلغاء تُحدَّد في العرض والعقد الخاص بكل مناسبة، ويكون
            العقد المعتمد هو المرجع.
          </p>
          <h2>حقوق الأعمال</h2>
          <p>
            تُسلَّم الصور والفيديو لاستخدامك الشخصي. نشر الاستوديو لأي عمل على الموقع يكون فقط بموافقتك.
          </p>
        </div>
      </Section>
    </>
  );
}
