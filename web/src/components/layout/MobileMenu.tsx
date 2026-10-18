"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

/** Accessible mobile menu: focus trap, Escape to close, focus returns to the toggle. */
export function MobileMenu({ bookHref, links }: { bookHref: string | null; links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
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
        className="relative z-50 grid size-11 place-items-center rounded-sm text-on-dark"
      >
        <span aria-hidden="true" className="relative block h-3.5 w-6">
          <span
            className={`absolute inset-x-0 top-0 h-0.5 bg-current transition-transform ${open ? "translate-y-1.5 rotate-45" : ""}`}
          />
          <span
            className={`absolute inset-x-0 bottom-0 h-0.5 bg-current transition-transform ${open ? "-translate-y-1.5 -rotate-45" : ""}`}
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
        className="fixed inset-0 z-40 bg-ink pt-[var(--header-h)] text-on-dark"
      >
        <nav aria-label="القائمة الرئيسية" className="px-[var(--gutter)] py-6">
          <ul className="flex flex-col gap-1 font-display text-2xl">
            {(links.some((l) => l.href === "/contact") ? links : [...links, { href: "/contact", label: "تواصل معنا" }]).map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="block border-b border-ink-line py-4" onClick={() => setOpen(false)}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <a
            href={bookHref ?? "/contact"}
            {...(bookHref ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            onClick={() => setOpen(false)}
            className="mt-8 flex min-h-14 items-center justify-center rounded-sm bg-gold px-6 text-lg font-medium text-ink"
          >
            {bookHref ? "احجز عبر واتساب" : "تواصل معنا"}
          </a>
        </nav>
      </div>
    </>
  );
}
