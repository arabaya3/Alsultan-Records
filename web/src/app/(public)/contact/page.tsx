import { PageIntro, Section } from "@/components/ui/Layout";
import { ErrorState } from "@/components/ui/States";
import { WhatsAppLink } from "@/components/ui/WhatsAppCta";
import { bookingHref, contactItems } from "@/features/public-content/contact";
import { getBusinessSettings } from "@/features/public-content/queries";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "تواصل معنا",
  description: "تواصل مع ستوديو وتسجيلات السلطان على واتساب أو بالهاتف للاستفسار عن مناسبتك.",
  path: "/contact",
});

export default async function ContactPage() {
  const settings = await getBusinessSettings();
  const s = settings.status === "ok" ? settings.data : null;
  const rows = contactItems(s);
  const wa = bookingHref(s);

  return (
    <>
      <PageIntro title="تواصل معنا" lead="أسرع طريقة: رسالة على واتساب فيها تفاصيل مناسبتك." />
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr]">
          <div>
            {settings.status === "unavailable" ? (
              <ErrorState body="تعذّر تحميل بيانات التواصل الآن. حاول مرة أخرى بعد قليل." />
            ) : rows.length ? (
              <dl className="divide-y divide-cream-line border-y border-cream-line">
                {rows.map((r) => (
                  <div key={r.key} className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]">
                    <dt className="text-on-cream-muted">{r.name}</dt>
                    <dd className="text-lg">
                      {r.href ? (
                        <a
                          href={r.href}
                          dir={r.ltr ? "ltr" : undefined}
                          className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4 hover:decoration-gold"
                          {...(r.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                        >
                          {r.label}
                        </a>
                      ) : (
                        r.label
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-lg text-on-cream-muted">بيانات التواصل غير متوفرة حالياً.</p>
            )}
          </div>
          {wa ? (
            <aside className="self-start rounded-md bg-ink p-8 text-on-dark">
              <h2 className="text-2xl font-semibold">عندك مناسبة؟</h2>
              <p className="mt-2 text-muted">اكتب لنا نوع المناسبة وتاريخها ومكانها، ونرجع لك.</p>
              <WhatsAppLink href={wa} className="mt-6" />
            </aside>
          ) : null}
        </div>
      </Section>
    </>
  );
}
