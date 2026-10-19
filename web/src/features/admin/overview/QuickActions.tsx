import Link from "next/link";

const ACTIONS: { label: string; href: string; external?: boolean }[] = [
  { label: "أضف ألبوم", href: "/admin/albums" },
  { label: "أضف فيديو", href: "/admin/videos" },
  { label: "أضف عرض", href: "/admin/content/offers/new" },
  { label: "عدّل البكجات", href: "/admin/content/packages" },
  { label: "عدّل الرئيسية", href: "/admin/content/home" },
  { label: "افتح الموقع", href: "/", external: true },
];

const cls =
  "flex min-h-14 items-center justify-center rounded-md border border-cream-line bg-[#fffdf8] px-4 py-3 text-center text-base font-semibold transition-colors hover:border-gold focus-visible:border-gold";

/** Big touch-friendly shortcuts for the owner's everyday edits. */
export function QuickActions() {
  return (
    <nav aria-label="إجراءات سريعة" className="mb-6" data-testid="quick-actions">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {ACTIONS.map((a) => (
          <li key={a.href}>
            {a.external ? (
              <a href={a.href} target="_blank" rel="noopener noreferrer" className={cls}>
                {a.label} <span aria-hidden="true" className="ms-1">↗</span>
                <span className="sr-only">(تفتح في نافذة جديدة)</span>
              </a>
            ) : (
              <Link href={a.href} className={cls}>
                {a.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
