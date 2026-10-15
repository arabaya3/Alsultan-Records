import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { LogoutButton } from "@/features/auth/components/LogoutButton";

export const metadata: Metadata = {
  title: { default: "بوابة العميل", template: "%s | بوابة العميل" },
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="bg-ink text-on-dark">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-gold focus:px-4 focus:py-2 focus:text-ink"
        >
          تخطَّ إلى المحتوى
        </a>
        <div className="mx-auto flex h-20 w-full max-w-[var(--content-max)] items-center gap-6 px-[var(--gutter)]">
          <Logo height={52} />
          <nav aria-label="البوابة">
            <Link href="/portal" className="py-2 transition-colors hover:text-gold">
              مناسباتي
            </Link>
          </nav>
          <div className="ms-auto">
            <LogoutButton className="min-h-11 rounded-sm border border-ink-line px-4 text-sm transition-colors hover:border-gold disabled:opacity-60" />
          </div>
        </div>
      </header>
      <main id="main" className="flex-1 bg-cream">
        {children}
      </main>
    </>
  );
}
