import { PageIntro, Section } from "@/components/ui/Layout";
import { TrackForm } from "@/features/bookings/public/TrackForm";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = {
  ...pageMetadata({
    title: "تابع طلبك",
    description: "تابع حالة طلب الحجز برمز المتابعة.",
    path: "/track",
  }),
  robots: { index: false, follow: true },
};

export default function TrackPage() {
  return (
    <>
      <PageIntro title="تابع طلبك" lead="أدخل رمز المتابعة الذي ظهر لك بعد إرسال الطلب." />
      <Section>
        <div className="max-w-3xl">
          <TrackForm />
        </div>
      </Section>
    </>
  );
}
