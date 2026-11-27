"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * One «⋯» button per row; the row's actions open below it (edit, feature, hide, reorder…). Opens on click, closes on
 * Esc (focus back to the button), on a click outside, and when an action link is followed. Keyboard: Tab moves through
 * the actions. The actions themselves are ordinary links and forms (ActionForm variant="menu").
 */
export function RowMenu({ label, children, testId, align = "end" }: { label: string; children: ReactNode; testId?: string; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // A confirmation dialog inside the menu handles its own Esc.
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // first action gets focus
    wrap.current?.querySelector<HTMLElement>("[data-menu-panel] a, [data-menu-panel] button")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative inline-block" data-testid={testId}>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex size-11 items-center justify-center rounded-lg border bg-[#fffdf8] text-on-cream transition-colors ${
          open ? "border-gold ring-2 ring-gold/40" : "border-cream-line hover:border-on-cream-muted"
        }`}
        data-testid={testId ? `${testId}-button` : "row-menu-button"}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      <div
        id={id}
        role="group"
        aria-label={label}
        data-menu-panel
        hidden={!open}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a[href]")) setOpen(false);
        }}
        className={`absolute top-full z-30 mt-1.5 min-w-52 rounded-xl border border-cream-line bg-[#fffdf8] p-1.5 text-sm shadow-[0_16px_40px_-18px_rgb(40_30_10/0.45)] ${
          align === "end" ? "end-0" : "start-0"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** A plain link styled as a menu row. */
export function MenuLink({ href, children, icon, external }: { href: string; children: ReactNode; icon?: ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start hover:bg-cream-2 focus-visible:bg-cream-2"
    >
      {icon ? <span aria-hidden="true" className="text-on-cream-muted">{icon}</span> : null}
      <span className="flex-1">{children}</span>
    </a>
  );
}

export function MenuSeparator() {
  return <hr className="my-1 border-cream-line" />;
}
