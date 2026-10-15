import { PageIntro, Section } from "@/components/ui/Layout";
import { BookingForm } from "@/features/bookings/public/BookingForm";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "احجز مناسبتك",
  description: "أرسل تفاصيل مناسبتك لستوديو وتسجيلات السلطان ونتواصل معك لتأكيد الموعد.",
  path: "/book",
});

export default function BookPage() {
  return (
    <>
      <PageIntro title="احكِ لنا عن مناسبتك" lead="خطوتين قصار. الأساسيات أولاً، والباقي إذا حاب." />
      <Section>
        <div className="max-w-2xl">
          <BookingForm />
        </div>
      </Section>
    </>
  );
}
