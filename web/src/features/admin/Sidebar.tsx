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
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <>
      <div className="flex items-center justify-between border-b border-ink-line bg-ink px-4 py-3 text-on-dark lg:hidden">
        <span className="font-display font-bold">
          لوحة السلطان<span className="text-gold">.</span>
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="admin-nav"
          onClick={() => setOpen((v) => !v)}
          className="min-h-10 rounded-sm border border-ink-line px-3 text-sm"
        >
          {open ? "إغلاق القائمة" : "القائمة"}
        </button>
      </div>
      <aside
        id="admin-nav"
        className={`${open ? "block" : "hidden"} border-ink-line bg-ink text-on-dark lg:sticky lg:top-0 lg:block lg:h-dvh lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:border-e`}
      >
        <div className="hidden px-5 pb-2 pt-6 lg:block">
          <Link href="/admin" className="font-display text-lg font-bold">
            لوحة السلطان<span className="text-gold">.</span>
          </Link>
        </div>
        <nav aria-label="أقسام لوحة الإدارة" className="px-3 py-3">
          {groups.map((g) => (
            <div key={g.title} className="mb-4">
              <p className="px-2 pb-1 text-xs text-muted">{g.title}</p>
              <ul>
                {g.items.map((i) => (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      onClick={() => setOpen(false)}
                      aria-current={isActive(i.href) ? "page" : undefined}
                      className={`block rounded-sm px-2 py-1.5 text-sm transition-colors ${
                        isActive(i.href) ? "bg-ink-2 text-gold" : "hover:bg-ink-2"
                      }`}
                    >
                      {i.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-ink-line px-5 py-4 text-sm">
          <p className="truncate">{name}</p>
          <p className="text-xs text-muted">{roleLabel}</p>
          <form action={signOut} className="mt-2">
            <button type="submit" className="text-xs text-muted underline underline-offset-4 hover:text-on-dark">
              تسجيل الخروج
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
