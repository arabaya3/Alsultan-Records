"use client";

import { useId, type InputHTMLAttributes } from "react";
import { arNum } from "@/features/public-content/labels";

/** «تم اختيار ٣ صور: a.jpg، b.cr3 و٢ أخرى» — names of the first files, then how many more. */
export function pickedLabel(names: string[], show = 3): string {
  if (!names.length) return "لم تُختر صور بعد.";
  const n = names.length;
  const count = n === 1 ? "صورة واحدة" : n === 2 ? "صورتين" : n <= 10 ? `${arNum(n)} صور` : `${arNum(n)} صورة`;
  const head = names.slice(0, show).join("، ");
  const rest = n > show ? ` و${arNum(n - show)} أخرى` : "";
  return `تم اختيار ${count}: ${head}${rest}`;
}

/**
 * Arabic file chooser: the native <input type=file> stays in the page (visually hidden, still in the Tab order and
 * opened with Space/Enter, so keyboard and assistive tech use the real control) and an Arabic button + status line
 * replace the browser's own «Choose Files / No file chosen» text.
 */
export function FilePicker({
  files,
  buttonLabel = "اختيار الصور",
  hint,
  inputProps,
}: {
  files: File[];
  buttonLabel?: string;
  hint?: string;
  inputProps: InputHTMLAttributes<HTMLInputElement> & { "data-testid"?: string; ref?: React.Ref<HTMLInputElement> };
}) {
  const id = useId();
  const statusId = `${id}-status`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <input id={id} type="file" aria-describedby={statusId} {...inputProps} className="peer sr-only" />
      <label
        htmlFor={id}
        data-file-picker-button
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border border-gold bg-ivory px-4 text-sm font-medium text-on-cream transition-colors hover:bg-gold/15 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {buttonLabel}
      </label>
      <p id={statusId} aria-live="polite" data-file-picker-status className="min-w-0 text-sm text-on-cream-muted [overflow-wrap:anywhere]">
        {pickedLabel(files.map((f) => f.name))}
        {hint ? <span className="block text-xs">{hint}</span> : null}
      </p>
    </div>
  );
}
