"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavGroup } from "./nav";

export function Sidebar({
  groups,
  name,
  roleLabel,
  signOut,
}: {
  groups: NavGroup[];
  name: string;
  roleLabel: string;
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Only the most specific matching entry is current (e.g. /admin/videos/categories ≠ /admin/videos). An entry also
  // matches its extra prefixes (`match`), e.g. «الإعدادات» on its tab pages.
  const hit = (href: string) => (pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`)) ? href.length : 0);
  const activeHref = groups
    .flatMap((g) => g.items)
    .map((i) => ({ href: i.href, len: Math.max(hit(i.href), ...(i.match ?? []).map(hit)) }))
    .filter((x) => x.len > 0)
    .sort((a, b) => b.len - a.len)[0]?.href;
  const isActive = (href: string) => href === activeHref;

  const brand = (
    <span className="flex flex-col items-start">
      <span className="font-display text-2xl leading-tight font-bold">لوحة السلطان</span>
      <span dir="ltr" className="mt-1 text-[0.65rem] tracking-[0.35em] text-gold">SULTAN RECORDS</span>
      <span aria-hidden="true" className="mt-2 h-px w-14 bg-gold" />
    </span>
  );
  const link = (i: NavGroup["items"][number]) => (
    <li key={i.href}>
      <Link
        href={i.href}
        onClick={() => setOpen(false)}
        aria-current={isActive(i.href) ? "page" : undefined}
        className={`flex min-h-11 items-center rounded-lg px-3 py-2 text-base transition-colors ${
          isActive(i.href)
            ? "border-s-[3px] border-gold bg-gradient-to-l from-gold/35 to-gold/10 font-semibold text-gold"
            : "text-ivory hover:bg-white/5 hover:text-gold"
        }`}
      >
        {i.label}
      </Link>
    </li>
  );

  return (
    <>
      <div className="flex items-center justify-between border-b border-hairline bg-navy px-4 py-3 text-ivory lg:hidden">
        <span className="font-display text-lg font-bold">لوحة السلطان</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="admin-nav"
          onClick={() => setOpen((v) => !v)}
          className="min-h-11 rounded-lg border border-hairline-gold px-3 text-sm"
        >
          {open ? "إغلاق القائمة" : "القائمة"}
        </button>
      </div>
      <aside
        id="admin-nav"
        className={`${open ? "block" : "hidden"} bg-navy text-ivory lg:sticky lg:top-0 lg:block lg:h-dvh lg:w-64 lg:shrink-0 lg:overflow-y-auto`}
      >
        <div className="hidden px-6 pt-8 pb-4 lg:block">
          <Link href="/admin">
            {brand}
          </Link>
        </div>
        <nav aria-label="أقسام لوحة الإدارة" className="px-3 pb-3 lg:pt-2">
          {groups.map((g, gi) => {
            const list = <ul className="space-y-0.5">{g.items.map(link)}</ul>;
            const divider = gi > 0 ? "mt-4 border-t border-hairline pt-4" : "";
            if (g.collapsible) {
              const holdsActive = g.items.some((i) => i.href === activeHref);
              return (
                <details key={g.title} open={holdsActive || undefined} className={`group ${divider}`} data-testid="nav-group-collapsible">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-lg px-3 text-sm text-ivory-muted hover:bg-white/5 [&::-webkit-details-marker]:hidden">
                    {g.title}
                    <span aria-hidden="true" className="transition-transform group-open:rotate-180">▾</span>
                  </summary>
                  {list}
                </details>
              );
            }
            return (
              <div key={g.title} className={divider}>
                {/* A one-entry group named like its entry (e.g. «الإعدادات») shows the link only, not the same word twice. */}
                {g.items.length === 1 && g.items[0].label === g.title ? null : <p className="px-3 pb-1.5 text-sm text-ivory-muted">{g.title}</p>}
                {list}
              </div>
            );
          })}
        </nav>
        <div className="mx-3 mt-2 border-t border-hairline px-3 py-4 text-sm">
          <p className="truncate">{name}</p>
          <p className="text-xs text-ivory-muted">{roleLabel}</p>
          <form action={signOut} className="mt-2">
            <button type="submit" className="inline-flex min-h-11 items-center text-xs text-ivory-muted underline underline-offset-4 hover:text-gold">
              تسجيل الخروج
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
