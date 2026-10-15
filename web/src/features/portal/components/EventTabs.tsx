"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { EventTabs as Tabs } from "@/features/portal/queries";

const TABS: { key: keyof Tabs | "overview"; label: string }[] = [
  { key: "overview", label: "نظرة عامة" },
  { key: "gallery", label: "المعرض" },
  { key: "selection", label: "اختيار صور الألبوم" },
  { key: "videos", label: "الأفلام" },
  { key: "files", label: "الملفات" },
  { key: "quotes", label: "عروض الأسعار" },
  { key: "contracts", label: "العقود" },
  { key: "payments", label: "الدفعات" },
];

export function EventTabs({ eventId, tabs }: { eventId: string; tabs: Tabs }) {
  const seg = useSelectedLayoutSegment() ?? "overview";
  const shown = TABS.filter((t) => t.key === "overview" || tabs[t.key as keyof Tabs]);
  return (
    <nav aria-label="أقسام المناسبة" className="-mb-px overflow-x-auto">
      <ul className="flex min-w-max gap-1">
        {shown.map((t) => {
          const active = seg === t.key;
          const href = `/portal/events/${eventId}${t.key === "overview" ? "" : `/${t.key}`}`;
          return (
            <li key={t.key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-12 items-center border-b-2 px-4 text-[0.95rem] transition-colors ${
                  active ? "border-gold text-on-dark" : "border-transparent text-muted hover:text-on-dark"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
