"use client";

import { useState, type ReactNode } from "react";

/**
 * The album's photos in two views of ONE list: «التفاصيل والأوصاف» (cover, visibility, status, alt texts, trash) and
 * «ترتيب الصور». Both stay mounted — switching only hides one — so unsaved alt texts or an unsaved order are never
 * lost by switching, and an upload in progress (the uploader above) is not touched. The URL follows (?view=order)
 * without a navigation, so a reload or a shared link opens the same view.
 */
export function PhotoViews({ initial, details, order }: { initial: "details" | "order"; details: ReactNode; order: ReactNode | null }) {
  const [view, setView] = useState<"details" | "order">(order ? initial : "details");
  const pick = (v: "details" | "order") => {
    setView(v);
    const url = new URL(window.location.href);
    if (v === "order") url.searchParams.set("view", "order");
    else url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", url);
  };
  return (
    <>
      {order ? (
        <div role="group" aria-label="طريقة عرض الصور" className="mb-4 flex flex-wrap gap-2" data-testid="photo-view-switch">
          {(
            [
              ["details", "التفاصيل والأوصاف"],
              ["order", "ترتيب الصور"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => pick(v)}
              data-testid={`photo-view-${v}`}
              className={`inline-flex min-h-11 items-center rounded-sm border px-4 text-sm font-medium ${view === v ? "border-gold bg-gold text-ink" : "border-cream-line hover:border-gold"}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <div hidden={view !== "details"} data-photo-view="details">
        {details}
      </div>
      {order ? (
        <div hidden={view !== "order"} data-photo-view="order">
          {order}
        </div>
      ) : null}
    </>
  );
}
