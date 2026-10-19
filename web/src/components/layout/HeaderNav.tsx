"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** True when `href` is the current page or one of its sub-pages ("/" only matches itself). */
export function isActivePath(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop main nav (labels/order from the CMS). Active link: gold text + gold underline, aria-current="page". */
export function HeaderNav({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="القائمة الرئيسية" className="hidden lg:block">
      <ul className="flex items-center gap-8 xl:gap-11">
        {links.map((l) => {
          const active = isActivePath(pathname, l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex min-h-11 items-center text-[1.0625rem] transition-colors duration-200 after:absolute after:inset-x-0 after:bottom-1 after:h-0.5 after:origin-center after:rounded-full after:bg-gold after:transition-transform after:duration-200 ${
                  active ? "text-gold after:scale-x-100" : "text-ivory after:scale-x-0 hover:text-gold hover:after:scale-x-50"
                }`}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
