import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { BrandEntrance } from "@/components/motion/Reveal";
import { WhatsAppLink } from "@/components/ui/WhatsAppCta";
import { bookingHref } from "@/features/public-content/contact";
import { getBusinessSettings } from "@/features/public-content/queries";
import { NAV_LINKS } from "@/features/public-content/site";
import { MobileMenu } from "./MobileMenu";

export async function Header() {
  const settings = await getBusinessSettings();
  const book = bookingHref(settings.status === "ok" ? settings.data : null);
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
          <Logo height={60} priority className="lg:!h-[84px]" />
        </BrandEntrance>

        <nav aria-label="القائمة الرئيسية" className="hidden lg:block">
          <ul className="flex items-center gap-14 text-[1.0625rem]">
            {NAV_LINKS.map((l) => (
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
          <MobileMenu bookHref={book} />
        </div>
      </div>
    </header>
  );
}
