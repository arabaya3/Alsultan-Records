"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

/** Copies `text` to the clipboard; says so for a moment (and to screen readers). A menu row. */
export function CopyButton({ text, label, icon }: { text: string; label: string; icon?: ReactNode }) {
  const [done, setDone] = useState<"" | "ok" | "fail">("");
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone("ok");
        } catch {
          setDone("fail");
        }
        setTimeout(() => setDone(""), 2000);
      }}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start hover:bg-cream-2 focus-visible:bg-cream-2"
    >
      {icon ? <span aria-hidden="true" className="text-on-cream-muted">{icon}</span> : null}
      <span className="flex-1">{label}</span>
      <span role="status" className="text-xs text-success">
        {done === "ok" ? "نُسخ" : done === "fail" ? "تعذّر النسخ" : ""}
      </span>
    </button>
  );
}

/** A <select> that opens the chosen URL (filters in the page address, e.g. a category). Works with the keyboard. */
export function SelectNav({ label, value, options, className = "" }: { label: string; value: string; options: { value: string; label: string }[]; className?: string }) {
  const router = useRouter();
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => router.push(e.target.value)}
        className="field !min-h-11 !rounded-xl !py-1.5 text-sm font-medium"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
