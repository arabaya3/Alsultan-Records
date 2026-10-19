import Link from "next/link";
import { activeLogoSrc, Logo } from "@/components/brand/Logo";
import { Container } from "@/components/ui/Layout";
import { FacebookIcon, PhoneIcon, YouTubeIcon } from "@/components/ui/SocialIcons";
import { WhatsAppIcon } from "@/components/ui/WhatsAppCta";
import { contactItems } from "@/features/public-content/contact";
import { getBusinessSettings } from "@/features/public-content/queries";

// ≥44px touch targets everywhere (the footer test measures every link on mobile).
const linkCls = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 transition-colors duration-200 hover:text-gold";

const SOCIAL: Record<string, { label: string; icon: React.ReactNode }> = {
  whatsapp: { label: "واتساب", icon: <WhatsAppIcon size={18} /> },
  youtube: { label: "YouTube", icon: <YouTubeIcon /> },
  facebook: { label: "Facebook", icon: <FacebookIcon /> },
  phone: { label: "", icon: <PhoneIcon /> },
};

/**
 * Compact footer, as in the references: one dark band.
 *   Row 1: © copyright (start) · original logo (center) · WhatsApp / YouTube / Facebook / phone (end).
 *   Row 2: CMS footer links + privacy/terms, small and quiet.
 * No booking band here (no huge CTA on every page). Height comes from content only.
 */
export async function Footer() {
  const settings = await getBusinessSettings();
  const s = settings.status === "ok" ? settings.data : null;
  const contacts = contactItems(s).filter((c) => c.href && c.key in SOCIAL);
  const legal = [
    { href: "/privacy", label: "الخصوصية" },
    { href: "/terms", label: "الشروط" },
  ];

  return (
    <footer data-site-footer className="site-footer-flow bg-night-deep text-ivory">
      <Container className="grid items-center justify-items-center gap-x-8 gap-y-3 py-6 md:justify-items-stretch md:grid-cols-[1fr_auto_1fr] md:py-5">
        {/* Site pages live in the header nav; only the legal links stay here, inline with the copyright. */}
        <nav aria-label="روابط قانونية" className="order-3 flex flex-wrap items-center justify-center gap-x-4 text-sm text-ivory-muted md:order-1 md:justify-self-start">
          <span>© جميع الحقوق محفوظة</span>
          {legal.map((l) => (
            <Link key={l.href} href={l.href} className={linkCls}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="order-1 flex flex-col items-center gap-1 md:order-2 md:justify-self-center">
          <Logo height={64} src={activeLogoSrc(s?.active_logo_id)} />
          {/* Owner-editable tagline (admin «الهوية»): the only public place it appears. */}
          {s?.tagline ? <p data-footer-tagline className="max-w-xs text-center text-xs text-ivory-muted">{s.tagline}</p> : null}
        </div>

        <ul aria-label="تواصل" className="order-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-0 text-sm md:order-3 md:justify-self-end">
          {contacts.length ? (
            contacts.map((c) => (
              <li key={c.key}>
                <a
                  href={c.href!}
                  className={linkCls}
                  {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  {SOCIAL[c.key].icon}
                  {c.key === "phone" ? (
                    <>
                      <span className="sr-only">{c.name}: </span>
                      <span dir="ltr">{c.label}</span>
                    </>
                  ) : (
                    <span>{SOCIAL[c.key].label}</span>
                  )}
                </a>
              </li>
            ))
          ) : (
            <li>
              <Link href="/contact" className={linkCls}>
                تواصل معنا
              </Link>
            </li>
          )}
        </ul>
      </Container>

    </footer>
  );
}
