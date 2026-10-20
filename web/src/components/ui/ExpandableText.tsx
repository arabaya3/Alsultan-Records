"use client";

import { useId, useState } from "react";

/**
 * Long owner text (up to 10,000 chars since 0024) on a card: the first `lines` lines, then «اقرأ المزيد» expands in
 * place (aria-expanded). Short texts render as a plain paragraph with no button. The full text is always in the DOM
 * (search engines, screen readers, find-in-page); only its visible height is clamped.
 */
export function ExpandableText({ text, className = "", threshold = 280 }: { text: string; className?: string; threshold?: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const long = text.length > threshold;
  return (
    <>
      <p id={id} data-expandable={long ? (open ? "open" : "closed") : undefined} className={`whitespace-pre-line break-words [overflow-wrap:anywhere] ${long && !open ? "line-clamp-5" : ""} ${className}`}>
        {text}
      </p>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="mt-1 inline-flex min-h-11 items-center self-start text-sm font-medium text-gold underline underline-offset-4 hover:text-ivory"
        >
          {open ? "عرض أقل" : "اقرأ المزيد"}
        </button>
      ) : null}
    </>
  );
}
