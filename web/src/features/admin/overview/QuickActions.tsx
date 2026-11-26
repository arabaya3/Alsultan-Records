import Link from "next/link";

/**
 * The owner's everyday shortcuts on a navy bar: «أضف ألبوم» first (gold), then videos and offers, and a small
 * «تعديل الموقع» menu for the home page and the packages. Same destinations as before; «فتح الموقع» sits in the header.
 */
export function QuickActions() {
  const textLink =
    "inline-flex min-h-11 items-center text-lg font-medium text-ivory underline decoration-gold decoration-1 underline-offset-[10px] transition-colors hover:text-gold";
  return (
    <nav aria-label="إجراءات سريعة" className="mb-8" data-testid="quick-actions">
      <div className="flex flex-col gap-5 rounded-2xl bg-navy px-6 py-6 text-ivory sm:px-10 md:flex-row md:items-center md:justify-between">
        <ul className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <li>
            <Link
              href="/admin/albums"
              className="inline-flex min-h-14 items-center rounded-xl bg-gradient-to-b from-[#f0c865] via-gold to-gold-press px-10 font-display text-xl font-bold text-ink shadow-[0_6px_18px_-8px_rgb(233_185_73/0.6)] transition-[filter] hover:brightness-105"
            >
              أضف ألبوم
            </Link>
          </li>
          <li className="flex items-center gap-8">
            <span aria-hidden="true" className="hidden h-8 w-px bg-hairline-gold sm:block" />
            <Link href="/admin/videos" className={textLink}>
              أضف فيديو
            </Link>
          </li>
          <li className="flex items-center gap-8">
            <span aria-hidden="true" className="hidden h-8 w-px bg-hairline-gold sm:block" />
            <Link href="/admin/content/offers/new" className={textLink}>
              أضف عرض
            </Link>
          </li>
        </ul>
        <details className="group relative w-fit" data-testid="edit-site-menu">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-lg border border-ivory/70 px-5 text-lg [&::-webkit-details-marker]:hidden">
            تعديل الموقع
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform group-open:rotate-180">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </summary>
          <ul className="absolute end-0 z-20 mt-2 w-full min-w-48 overflow-hidden rounded-lg border border-hairline bg-navy-deep shadow-xl">
            <li>
              <Link href="/admin/content/home" className="flex min-h-12 items-center px-5 hover:bg-white/5 hover:text-gold">
                تعديل الرئيسية
              </Link>
            </li>
            <li className="border-t border-hairline">
              <Link href="/admin/content/packages" className="flex min-h-12 items-center px-5 hover:bg-white/5 hover:text-gold">
                تعديل البكجات
              </Link>
            </li>
          </ul>
        </details>
      </div>
    </nav>
  );
}
