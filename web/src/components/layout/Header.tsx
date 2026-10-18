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

/** Logo (start/right) · CMS nav (center) · gold WhatsApp booking button (end/left). Dark bar, hairline bottom. */
export async function Header() {
  const [settings, nav] = await Promise.all([getBusinessSettings(), getSiteNav()]);
  const s = settings.status === "ok" ? settings.data : null;
  const book = bookingHref(s);
  const links = nav.header.map((l) => ({ href: l.href, label: l.label }));
  return (
    <header className="relative z-40 border-b border-hairline bg-night-deep/95 text-ivory">
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

        <div className="hidden shrink-0 items-center lg:flex">
          {book ? (
            <WhatsAppLink href={book} />
          ) : (
            <Link href="/contact" className={buttonClasses({ variant: "outline" })}>
              تواصل معنا
            </Link>
          )}
        </div>

        <div className="ms-auto lg:hidden">
          <MobileMenu bookHref={book} links={links} />
        </div>
      </div>
    </header>
  );
}
