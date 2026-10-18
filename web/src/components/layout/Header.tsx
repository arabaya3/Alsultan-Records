import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { BrandEntrance } from "@/components/motion/Reveal";
import { WhatsAppLink } from "@/components/ui/WhatsAppCta";
import { bookingHref } from "@/features/public-content/contact";
import { getBusinessSettings } from "@/features/public-content/queries";
import { getSiteNav } from "@/features/public-content/cms-queries";
import { activeLogoSrc } from "@/components/brand/Logo";
import { MobileMenu } from "./MobileMenu";

export async function Header() {
  const [settings, nav] = await Promise.all([getBusinessSettings(), getSiteNav()]);
  const s = settings.status === "ok" ? settings.data : null;
  const book = bookingHref(s);
  const links = nav.header.map((l) => ({ href: l.href, label: l.label }));
  return (
    <header className="relative z-40 bg-ink text-on-dark">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-gold focus:px-4 focus:py-2 focus:text-ink"
      >
        تخطَّ إلى المحتوى
      </a>
      <div className="mx-auto flex h-[var(--header-h)] w-full max-w-[var(--content-max)] items-center gap-6 px-[var(--gutter)] lg:h-[104px] lg:gap-14">
        <BrandEntrance>
          <Logo height={60} priority className="lg:!h-[84px]" src={activeLogoSrc(s?.active_logo_id)} />
        </BrandEntrance>

        <nav aria-label="القائمة الرئيسية" className="hidden lg:block">
          <ul className="flex items-center gap-14 text-[1.0625rem]">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="py-2 transition-colors hover:text-gold">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto hidden items-center lg:flex">
          {book ? (
            <WhatsAppLink href={book} className="min-w-44" />
          ) : (
            <Link href="/contact" className="py-2 text-[1.0625rem] transition-colors hover:text-gold">
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
