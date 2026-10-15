import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export const metadata: Metadata = { title: "الصفحة غير موجودة", robots: { index: false } };

export default function NotFound() {
  return (
    <main id="main" className="grid flex-1 place-items-center bg-ink px-[var(--gutter)] py-20 text-on-dark">
      <div className="max-w-lg text-center">
        <div className="flex justify-center">
          <Logo height={80} />
        </div>
        <h1 className="mt-10 text-4xl font-bold md:text-5xl">
          الصفحة مش موجودة<span className="text-gold">.</span>
        </h1>
        <p className="mt-4 text-lg text-muted">يمكن الرابط تغيّر أو انحذف. جرّب من هون:</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-8">
          <Link href="/" className="inline-flex min-h-12 items-center rounded-sm bg-gold px-8 font-medium text-ink">
            الرئيسية
          </Link>
          <Link href="/work" className="underline decoration-1 underline-offset-8">
            أعمالنا
          </Link>
        </div>
      </div>
    </main>
  );
}
