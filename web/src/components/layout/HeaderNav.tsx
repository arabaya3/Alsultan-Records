"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { activeHref } from "./nav-active";

export { isActivePath } from "./nav-active";

type NavLink = { href: string; label: string };

/** Current active href (query-aware, see nav-active.ts). Needs a Suspense boundary (useSearchParams). */
export function useActiveHref(links: NavLink[]): string | null {
  const pathname = usePathname();
  const search = useSearchParams();
  return activeHref(pathname, new URLSearchParams(search?.toString() ?? ""), links.map((l) => l.href));
}

/** Path-only fallback while the query is not known yet (prerendered HTML / before hydration). */
export function usePathActiveHref(links: NavLink[]): string | null {
  return activeHref(usePathname(), null, links.map((l) => l.href));
}

function NavList({ links, active }: { links: NavLink[]; active: string | null }) {
  return (
    <ul className="flex items-center gap-8 xl:gap-11">
      {links.map((l) => {
        const on = active === l.href;
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={on ? "page" : undefined}
              className={`relative inline-flex min-h-11 items-center text-[1.0625rem] transition-colors duration-200 after:absolute after:inset-x-0 after:bottom-1 after:h-0.5 after:origin-center after:rounded-full after:bg-gold after:transition-transform after:duration-200 ${
                on ? "text-gold after:scale-x-100" : "text-ivory after:scale-x-0 hover:text-gold hover:after:scale-x-50"
              }`}
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
function LiveNavList({ links }: { links: NavLink[] }) {
  return <NavList links={links} active={useActiveHref(links)} />;
}
function PathNavList({ links }: { links: NavLink[] }) {
  return <NavList links={links} active={usePathActiveHref(links)} />;
}

/** Desktop main nav (labels/order from the CMS). Active link: gold text + gold underline, aria-current="page". */
export function HeaderNav({ links }: { links: NavLink[] }) {
  return (
    <nav aria-label="القائمة الرئيسية" className="hidden lg:block">
      <Suspense fallback={<PathNavList links={links} />}>
        <LiveNavList links={links} />
      </Suspense>
    </nav>
  );
}
