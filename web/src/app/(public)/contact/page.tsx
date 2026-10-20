import { ContactBand } from "@/components/home/ContactBand";
import { FacebookIcon, PhoneIcon, YouTubeIcon } from "@/components/ui/SocialIcons";
import { Section } from "@/components/ui/Layout";
import { PageHero } from "@/components/ui/PageHero";
import { ErrorState } from "@/components/ui/States";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { contactItems, type ContactItem } from "@/features/public-content/contact";
import { getBusinessSettings } from "@/features/public-content/queries";
import { pageMetadata } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "تواصل معنا",
  description: "تواصل مع ستوديو وتسجيلات السلطان على واتساب أو بالهاتف للاستفسار عن مناسبتك.",
  path: "/contact",
});

function RowIcon({ k }: { k: ContactItem["key"] }) {
  switch (k) {
    case "whatsapp":
      return <WhatsAppIcon size={22} />;
    case "phone":
      return <PhoneIcon size={22} />;
    case "youtube":
      return <YouTubeIcon size={22} />;
    case "facebook":
      return <FacebookIcon size={22} />;
    default:
      return <span aria-hidden="true" className="size-2 rounded-full bg-gold" />;
  }
}

export default async function ContactPage() {
  const settings = await getBusinessSettings();
  const s = settings.status === "ok" ? settings.data : null;
  const rows = contactItems(s);

  return (
    <>
      <PageHero
        title={
          <>
            تواصل معنا<span className="text-gold">.</span>
          </>
        }
        lead="أسرع طريقة: رسالة على واتساب فيها تفاصيل مناسبتك."
      />
      <Section>
        {settings.status === "unavailable" ? (
          <ErrorState body="تعذّر تحميل بيانات التواصل الآن. حاول مرة أخرى بعد قليل." />
        ) : rows.length ? (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              // dl > div > (dt, dd) only (axe definition-list/dlitem): the icon lives inside the dt.
              <div key={r.key} className="relative min-w-0 rounded-lg border border-hairline-gold bg-surface p-5 ps-[5.25rem]">
                  <dt className="text-sm text-ivory-muted">
                    <span aria-hidden="true" className="absolute start-5 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full border border-gold/60 text-gold">
                      <RowIcon k={r.key} />
                    </span>
                    {r.name}
                  </dt>
                  <dd className="min-w-0 text-lg break-words [overflow-wrap:anywhere]">
                    {r.href ? (
                      <a
                        href={r.href}
                        dir={r.ltr ? "ltr" : undefined}
                        className="inline-flex min-h-11 max-w-full min-w-0 items-center underline decoration-1 underline-offset-4 [overflow-wrap:anywhere] hover:decoration-gold"
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
          <p className="text-lg text-ivory-muted">بيانات التواصل غير متوفرة حالياً.</p>
        )}
      </Section>
      <ContactBand settings={s} lead="اكتب لنا نوع المناسبة وتاريخها ومكانها، ونرجع لك." />
    </>
  );
}
