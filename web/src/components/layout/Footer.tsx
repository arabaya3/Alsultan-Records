import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Container } from "@/components/ui/Layout";
import { WhatsAppIcon, WhatsAppLink } from "@/components/ui/WhatsAppCta";
import { bookingHref, contactItems } from "@/features/public-content/contact";
import { getBusinessSettings } from "@/features/public-content/queries";
import { SITE_NAME_AR } from "@/features/public-content/site";
import { getSiteNav } from "@/features/public-content/cms-queries";
import { activeLogoSrc } from "@/components/brand/Logo";


const linkCls = "inline-flex min-h-11 items-center transition-colors hover:text-gold md:min-h-8";

/**
 * Compact booking band + footer. Height comes from content only (no min-height / h-screen);
 * the band is a single row on desktop and the footer is three tight groups.
 */
export async function Footer() {
  const [settings, nav] = await Promise.all([getBusinessSettings(), getSiteNav()]);
  const s = settings.status === "ok" ? settings.data : null;
  const book = bookingHref(s);
  const contacts = contactItems(s);

  return (
    <>
      <section aria-labelledby="book-band-title" data-booking-band className="border-t border-ink-line bg-ink-2 text-on-dark">
        <Container className="flex flex-col items-start gap-4 py-6 sm:flex-row sm:items-center sm:justify-between md:py-7">
          <h2 id="book-band-title" className="text-xl font-bold md:text-2xl">
            عندك مناسبة قريبة<span className="text-gold">؟</span>{" "}
            <span className="text-base font-normal text-muted md:text-lg">احكِ لنا على واتساب.</span>
          </h2>
          {book ? (
            <WhatsAppLink href={book} className="shrink-0" />
          ) : (
            <Link href="/contact" className="inline-flex min-h-11 items-center rounded-sm bg-gold px-6 font-medium text-ink">
              تواصل معنا
            </Link>
          )}
        </Container>
      </section>

      <footer data-site-footer className="bg-ink text-on-dark">
        <Container className="grid gap-8 py-8 sm:grid-cols-2 md:grid-cols-[1.3fr_1fr_1.3fr] md:gap-10">
          <div className="sm:col-span-2 md:col-span-1">
            <Logo height={56} src={activeLogoSrc(s?.active_logo_id)} />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
              {s?.tagline ?? "تصوير فوتوغرافي وأفلام أعراس ومناسبات وDJ."}
            </p>
          </div>

          <nav aria-labelledby="footer-links-title">
            <h2 id="footer-links-title" className="mb-2 text-sm font-semibold text-gold">
              روابط مهمة
            </h2>
            <ul className="grid grid-cols-2 gap-x-6 md:grid-cols-2 md:gap-x-8">
              {nav.footer.map((l) => (
                <li key={l.key}>
                  <Link href={l.href} className={linkCls}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-gold">تواصل</h2>
            {contacts.length ? (
              <ul className="grid">
                {contacts.map((c) => (
                  <li key={c.key}>
                    {c.href ? (
                      <a
                        href={c.href}
                        className={`${linkCls} gap-2`}
                        {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      >
                        {c.key === "whatsapp" ? <WhatsAppIcon size={16} /> : null}
                        <span className="sr-only">{c.name}: </span>
                        <span dir={c.ltr ? "ltr" : undefined}>{c.key === "whatsapp" ? "واتساب" : c.key === "facebook" ? "فيسبوك" : c.key === "youtube" ? "YouTube" : c.key === "instagram" ? "إنستغرام" : c.label}</span>
                      </a>
                    ) : (
                      <p className="py-2 text-sm text-muted md:py-1">{c.label}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Link href="/contact" className={linkCls}>
                تواصل معنا
              </Link>
            )}
          </div>
        </Container>
        <div className="border-t border-ink-line">
          <Container className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 text-sm text-muted">
            <p>© {SITE_NAME_AR}</p>
            <ul className="flex gap-6">
              <li>
                <Link href="/privacy" className="inline-flex min-h-11 items-center hover:text-gold">
                  الخصوصية
                </Link>
              </li>
              <li>
                <Link href="/terms" className="inline-flex min-h-11 items-center hover:text-gold">
                  الشروط
                </Link>
              </li>
            </ul>
          </Container>
        </div>
      </footer>
    </>
  );
}
