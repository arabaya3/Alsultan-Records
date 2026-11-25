"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type PackageTab = { key: string; label: string; count: number; panel: ReactNode };

/**
 * One package group at a time (WAI-ARIA tabs, automatic activation). Every panel is rendered on the server; the
 * inactive ones are `hidden`, so cards keep their ids and a link to /packages#<slug> opens the tab that holds the
 * package and scrolls to it (on load and on later hash changes). Keyboard: arrows move along the row in reading order
 * (RTL: ArrowLeft = next), Home/End jump to the ends; Tab leaves the row for the open panel.
 */
export function PackageTabs({ tabs }: { tabs: PackageTab[] }) {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelsRef = useRef<HTMLDivElement>(null);

  const openHash = useCallback(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    const panel = target?.closest<HTMLElement>("[data-package-panel]");
    if (!target || !panel || !panelsRef.current?.contains(panel)) return;
    const i = Number(panel.dataset.packagePanel);
    setActive(i);
    // After the panel is shown: bring the card into view (the browser could not while it was hidden).
    requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
  }, []);

  useEffect(() => {
    openHash();
    window.addEventListener("hashchange", openHash);
    return () => window.removeEventListener("hashchange", openHash);
  }, [openHash]);

  const select = (i: number, focus: boolean) => {
    setActive(i);
    if (focus) tabRefs.current[i]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const last = tabs.length - 1;
    const next = (d: number) => (active + d + tabs.length) % tabs.length;
    let to: number | null = null;
    if (e.key === "ArrowLeft") to = next(rtl ? 1 : -1);
    else if (e.key === "ArrowRight") to = next(rtl ? -1 : 1);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = last;
    if (to === null) return;
    e.preventDefault();
    select(to, true);
  };

  return (
    <>
      <div className="sticky top-0 z-20 border-b border-hairline bg-night/90 backdrop-blur">
        <div className="mx-auto w-full max-w-[var(--content-max)] px-[var(--gutter)]">
          <div role="tablist" aria-label="أنواع البكجات" data-package-tabs className="-mx-1 flex gap-2 overflow-x-auto px-1 py-3 [scrollbar-width:none]">
            {tabs.map((t, i) => {
              const on = i === active;
              return (
                <button
                  key={t.key}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`pkg-tab-${i}`}
                  aria-selected={on}
                  aria-controls={`pkg-panel-${i}`}
                  tabIndex={on ? 0 : -1}
                  data-package-tab={t.label}
                  onClick={() => select(i, false)}
                  onKeyDown={onKey}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-5 text-sm font-medium whitespace-nowrap transition-colors ${
                    on ? "border-gold bg-gold text-ink" : "border-hairline-gold text-ivory hover:border-gold"
                  }`}
                >
                  {t.label}
                  <span aria-hidden="true" className={on ? "text-ink/70" : "text-ivory-muted"}>
                    {t.count.toLocaleString("ar-PS")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div ref={panelsRef}>
        {tabs.map((t, i) => (
          <div
            key={t.key}
            role="tabpanel"
            id={`pkg-panel-${i}`}
            aria-labelledby={`pkg-tab-${i}`}
            data-package-panel={i}
            hidden={i !== active}
          >
            {t.panel}
          </div>
        ))}
      </div>
    </>
  );
}
