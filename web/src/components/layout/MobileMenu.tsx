"use client";

import Link from "next/link";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { useActiveHref, usePathActiveHref } from "./HeaderNav";

type NavLink = { href: string; label: string };

function MenuLinks({ links, active, onNavigate }: { links: NavLink[]; active: string | null; onNavigate: () => void }) {
  return (
    <ul className="flex flex-col gap-1 font-display text-2xl">
      {links.map((l) => (
        <li key={l.href}>
          <Link
            href={l.href}
            aria-current={active === l.href ? "page" : undefined}
            className={`flex min-h-14 items-center justify-between gap-4 border-b border-hairline py-3 transition-colors hover:text-gold ${active === l.href ? "text-gold" : ""}`}
            onClick={onNavigate}
          >
            {l.label}
            {active === l.href ? <span aria-hidden="true" className="h-0.5 w-8 rounded-full bg-gold" /> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
function LiveMenuLinks(p: { links: NavLink[]; onNavigate: () => void }) {
  return <MenuLinks {...p} active={useActiveHref(p.links)} />;
}
function PathMenuLinks(p: { links: NavLink[]; onNavigate: () => void }) {
  return <MenuLinks {...p} active={usePathActiveHref(p.links)} />;
}

/**
 * Accessible mobile menu: focus trap, Escape to close, focus returns to the toggle.
 * Smooth open/close via .menu-panel (globals.css) on the native [hidden] attribute; instant under reduced motion.
 */
export function MobileMenu({ bookHref, links }: { bookHref: string | null; links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // «تواصل معنا» is always one tap away in the menu, even when the CMS nav does not list it.
  const menuLinks = links.some((l) => l.href === "/contact") ? links : [...links, { href: "/contact", label: "تواصل معنا" }];
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const toggle = toggleRef.current;
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? []);
    focusables()[0]?.focus();
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = [toggle, ...focusables()].filter(Boolean) as HTMLElement[];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      toggle?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
        onClick={() => setOpen((o) => !o)}
        className="relative z-50 grid size-11 place-items-center rounded-sm text-ivory transition-colors hover:text-gold"
      >
        <span aria-hidden="true" className="relative block h-3.5 w-6">
          <span
            className={`absolute inset-x-0 top-0 h-0.5 bg-current transition-transform duration-200 ${open ? "translate-y-1.5 rotate-45" : ""}`}
          />
          <span
            className={`absolute inset-x-0 bottom-0 h-0.5 bg-current transition-transform duration-200 ${open ? "-translate-y-1.5 -rotate-45" : ""}`}
          />
        </span>
      </button>
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="true"
        aria-label="القائمة"
        hidden={!open}
        className="menu-panel fixed inset-0 z-40 overflow-y-auto bg-night-deep pt-[var(--header-h)] text-ivory"
      >
        <nav aria-label="القائمة الرئيسية" className="border-t border-hairline px-[var(--gutter)] py-6">
          <Suspense fallback={<PathMenuLinks links={menuLinks} onNavigate={() => setOpen(false)} />}>
            <LiveMenuLinks links={menuLinks} onNavigate={() => setOpen(false)} />
          </Suspense>
          <a
            href={bookHref ?? "/contact"}
            {...(bookHref ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            onClick={() => setOpen(false)}
            className="mt-8 flex min-h-14 items-center justify-center rounded-sm bg-gold px-6 text-lg font-medium text-ink transition-colors hover:bg-gold-press active:bg-gold-press"
          >
            {bookHref ? "احجز عبر واتساب" : "تواصل معنا"}
          </a>
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="mt-3 flex min-h-12 items-center justify-center rounded-sm border border-hairline px-6 text-base text-ivory transition-colors hover:border-gold hover:text-gold"
          >
            تسجيل الدخول
          </Link>
        </nav>
      </div>
    </>
  );
}
