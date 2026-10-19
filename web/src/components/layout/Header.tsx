import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { BrandEntrance } from "@/components/motion/Reveal";
import { WhatsAppLink } from "@/components/ui/WhatsAppCta";
import { buttonClasses } from "@/components/ui/Button";
import { bookingHref } from "@/features/public-content/contact";
import { getBusinessSettings } from "@/features/public-content/queries";
import { getSiteNav } from "@/features/public-content/cms-queries";
import { activeLogoSrc } from "@/components/brand/Logo";
import { HeaderNav } from "./HeaderNav";
import { MobileMenu } from "./MobileMenu";

const UserIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

/** Logo (start/right) · CMS nav (center) · «تسجيل الدخول» + gold WhatsApp booking button (end/left). */
export async function Header() {
  const [settings, nav] = await Promise.all([getBusinessSettings(), getSiteNav()]);
  const s = settings.status === "ok" ? settings.data : null;
  const book = bookingHref(s);
  const links = nav.header.map((l) => ({ href: l.href, label: l.label }));
  return (
    <header className="site-header-flow relative z-40 bg-night-deep/95 text-ivory">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-gold focus:px-4 focus:py-2 focus:text-ink"
      >
        تخطَّ إلى المحتوى
      </a>
      <div className="mx-auto flex h-[var(--header-h)] w-full max-w-[var(--content-max)] items-center gap-6 px-[var(--gutter)] lg:gap-10">
        <BrandEntrance>
          <Logo height={60} priority className="lg:!h-[68px]" src={activeLogoSrc(s?.active_logo_id)} />
        </BrandEntrance>

        <div className="hidden flex-1 justify-center lg:flex">
          <HeaderNav links={links} />
        </div>

        <div className="hidden shrink-0 items-center gap-5 lg:flex">
          <Link href="/login" data-login-link className="inline-flex min-h-11 items-center gap-2 text-ivory-muted transition-colors hover:text-gold">
            <UserIcon />
            تسجيل الدخول
          </Link>
          {book ? (
            <WhatsAppLink href={book} />
          ) : (
            <Link href="/contact" className={buttonClasses({ variant: "outline" })}>
              تواصل معنا
            </Link>
          )}
        </div>

        <div className="ms-auto flex items-center gap-1 lg:hidden">
          <Link href="/login" aria-label="تسجيل الدخول" title="تسجيل الدخول" data-login-link className="inline-flex size-11 items-center justify-center rounded-full text-ivory transition-colors hover:text-gold">
            <UserIcon />
          </Link>
          <MobileMenu bookHref={book} links={links} />
        </div>
      </div>
    </header>
  );
}
