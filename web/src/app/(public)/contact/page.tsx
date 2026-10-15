import { ButtonLink } from "@/components/ui/Button";
import { PageIntro, Section } from "@/components/ui/Layout";
import { ErrorState } from "@/components/ui/States";
import { getBusinessSettings } from "@/features/public-content/queries";
import { pageMetadata, safeHttp } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "تواصل معنا",
  description: "تواصل مع ستوديو وتسجيلات السلطان للاستفسار عن مناسبتك.",
  path: "/contact",
});

export default async function ContactPage() {
  const settings = await getBusinessSettings();
  const s = settings.status === "ok" ? settings.data : null;
  const rows = [
    s?.phone ? { label: "الهاتف", value: s.phone, href: `tel:${s.phone.replace(/\s/g, "")}`, ltr: true } : null,
    s?.whatsapp
      ? { label: "واتساب", value: s.whatsapp, href: `https://wa.me/${s.whatsapp.replace(/[^\d]/g, "")}`, ltr: true }
      : null,
    s?.email ? { label: "البريد", value: s.email, href: `mailto:${s.email}`, ltr: true } : null,
    s?.address ? { label: "العنوان", value: s.address, href: null, ltr: false } : null,
    s && safeHttp(s.instagram) ? { label: "إنستغرام", value: "صفحتنا على إنستغرام", href: s.instagram, ltr: false } : null,
    s && safeHttp(s.facebook) ? { label: "فيسبوك", value: "صفحتنا على فيسبوك", href: s.facebook, ltr: false } : null,
  ].filter((r) => r !== null);

  return (
    <>
      <PageIntro title="تواصل معنا" lead="أسرع طريقة: أرسل تفاصيل مناسبتك ونرجع لك." />
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr]">
          <div>
            {settings.status === "unavailable" ? (
              <ErrorState body="تعذّر تحميل بيانات التواصل الآن. يمكنك إرسال طلبك من صفحة الحجز." />
            ) : rows.length ? (
              <dl className="divide-y divide-cream-line border-y border-cream-line">
                {rows.map((r) => (
                  <div key={r.label} className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]">
                    <dt className="text-on-cream-muted">{r.label}</dt>
                    <dd className="text-lg">
                      {r.href ? (
                        <a
                          href={r.href}
                          dir={r.ltr ? "ltr" : undefined}
                          className="underline decoration-1 underline-offset-4 hover:decoration-gold"
                          {...(r.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                        >
                          {r.value}
                        </a>
                      ) : (
                        r.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-lg text-on-cream-muted">أرسل طلبك من صفحة الحجز وسنتواصل معك.</p>
            )}
          </div>
          <aside className="self-start rounded-md bg-ink p-8 text-on-dark">
            <h2 className="text-2xl font-semibold">عندك مناسبة؟</h2>
            <p className="mt-2 text-muted">أرسل التفاصيل الأساسية خلال دقيقة، ونتواصل معك.</p>
            <ButtonLink href="/book" className="mt-6">
              احجز مناسبتك
            </ButtonLink>
          </aside>
        </div>
      </Section>
    </>
  );
}
