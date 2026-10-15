import { PageIntro, Section } from "@/components/ui/Layout";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "سياسة الخصوصية",
  description: "كيف يتعامل ستوديو وتسجيلات السلطان مع بياناتك وصور مناسبتك.",
  path: "/privacy",
});

/*
 * LEGAL DRAFT — PENDING LOCAL LEGAL REVIEW.
 * This text was written as a reasonable starting point and has NOT been reviewed by a
 * lawyer familiar with Palestinian law. The owner must have it reviewed before launch.
 * Tracked in docs/public-site-notes.md ("Legal pages").
 */
export default function PrivacyPage() {
  return (
    <>
      <PageIntro title="سياسة الخصوصية" />
      <Section>
        <div className="prose-ar max-w-3xl text-lg leading-loose">
          <h2>ما البيانات التي نجمعها</h2>
          <p>
            عند إرسال طلب حجز نجمع ما تكتبه بنفسك: الاسم، رقم الهاتف، نوع المناسبة وتاريخها ومكانها،
            وأي ملاحظات. وعند استخدام بوابة العميل نحفظ ما يلزم لتسليم أعمالك واختياراتك.
          </p>
          <h2>لماذا نستخدمها</h2>
          <ul>
            <li>للتواصل معك بخصوص طلبك ومناسبتك.</li>
            <li>لتحضير العروض والعقود وتسليم الصور والفيديو.</li>
            <li>لحماية الموقع من الاستخدام المسيء.</li>
          </ul>
          <h2>صور مناسبتك</h2>
          <p>
            صورك وفيديوهاتك خاصة وتُعرض لك عبر روابط مؤقتة داخل البوابة. لا ننشر أي مناسبة على الموقع إلا
            بموافقتك، ويمكنك سحب الموافقة متى شئت فنزيلها من الموقع.
          </p>
          <h2>المشاركة مع أطراف أخرى</h2>
          <p>لا نبيع بياناتك. نستخدم مزوّدي خدمات تقنية للاستضافة والتخزين فقط بالقدر اللازم لتشغيل الخدمة.</p>
          <h2>حقوقك</h2>
          <p>يمكنك طلب الاطلاع على بياناتك أو تصحيحها أو حذفها بالتواصل معنا.</p>
        </div>
      </Section>
    </>
  );
}
