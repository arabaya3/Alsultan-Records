import { PageIntro, Section } from "@/components/ui/Layout";
import { ErrorState } from "@/components/ui/States";
import { WhatsAppLink } from "@/components/ui/WhatsAppCta";
import { bookingHref, telHref } from "@/features/public-content/contact";
import { getBusinessSettings } from "@/features/public-content/queries";
import { pageMetadata } from "@/features/public-content/seo";

// The old Turnstile-gated BookingForm (features/bookings/public) is intentionally kept in the
// codebase but no longer rendered: booking is via WhatsApp only.

export const metadata = pageMetadata({
  title: "احجز عبر واتساب",
  description: "احجز مناسبتك مع ستوديو وتسجيلات السلطان برسالة واتساب: نوع المناسبة والتاريخ والمكان والخدمات.",
  path: "/book",
});

const INCLUDE = [
  "نوع المناسبة (عرس، خطوبة، سهرة، تخرّج…)",
  "التاريخ، وإذا في أكثر من يوم",
  "المكان أو البلدة",
  "الخدمات اللي بتحتاجها: تصوير، فيلم، DJ",
];

export default async function BookPage() {
  const settings = await getBusinessSettings();
  const s = settings.status === "ok" ? settings.data : null;
  const wa = bookingHref(s);

  return (
    <>
      <PageIntro title="احجز عبر واتساب" lead="أرسل لنا رسالة على واتساب ونرجع لك لنتفق على التفاصيل." />
      <Section>
        <div className="grid max-w-4xl gap-10 md:grid-cols-[1.2fr_1fr] md:gap-14">
          <div>
            <h2 className="text-2xl font-semibold">اكتب في رسالتك</h2>
            <ul className="mt-4 grid gap-2 text-lg">
              {INCLUDE.map((x) => (
                <li key={x} className="flex gap-3">
                  <span aria-hidden="true" className="mt-3 size-1.5 shrink-0 rounded-full bg-gold" />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-on-cream-muted">الرسالة لا تعني حجزاً مؤكداً؛ نؤكد الموعد بعد ما نتفق.</p>
          </div>
          <div className="self-start">
            {settings.status === "unavailable" ? (
              <ErrorState body="تعذّر تحميل بيانات التواصل الآن. حاول مرة أخرى بعد قليل." />
            ) : (
              <div className="flex flex-col items-start gap-4">
                {wa ? <WhatsAppLink href={wa} size="lg" className="w-full" /> : null}
                {s?.phone ? (
                  <a
                    href={telHref(s.phone)}
                    className="inline-flex min-h-11 items-center gap-2 underline decoration-1 underline-offset-8 hover:decoration-gold"
                  >
                    <span>أو اتصل</span>
                    <span dir="ltr">{s.phone}</span>
                  </a>
                ) : null}
                {!wa && !s?.phone ? <p className="text-on-cream-muted">بيانات التواصل غير متوفرة حالياً.</p> : null}
              </div>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
