"use client";

import { useEffect, useId, useRef, useState } from "react";
import { inputCls } from "@/features/admin/ui";
import { slugFromTitle } from "@/lib/slug";

/**
 * Slug input with a visible label and linked help. NEW records (no defaultValue): the slug follows the title of the
 * same form (transliterated) until the admin edits the slug by hand. EXISTING records: the slug is never changed
 * automatically — editing a title must not break a published link. Uniqueness is checked by the server action.
 */
export function AutoSlug({
  label,
  hint,
  defaultValue,
  pattern,
  maxLength,
  titleName = "title",
  testId,
}: {
  label: string;
  hint: string;
  defaultValue?: string;
  pattern: string;
  maxLength: number;
  titleName?: string;
  testId?: string;
}) {
  const id = useId();
  const isNew = !defaultValue;
  const [slug, setSlug] = useState(defaultValue ?? "");
  const touched = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isNew) return;
    const form = inputRef.current?.form;
    const title = form?.elements.namedItem(titleName);
    if (!(title instanceof HTMLInputElement)) return;
    const follow = () => {
      if (!touched.current) setSlug(slugFromTitle(title.value, maxLength));
    };
    const reset = () => {
      touched.current = false; // the form was cleared after a successful create
      setSlug("");
    };
    title.addEventListener("input", follow);
    form?.addEventListener("reset", reset);
    return () => {
      title.removeEventListener("input", follow);
      form?.removeEventListener("reset", reset);
    };
  }, [isNew, titleName, maxLength]);

  return (
    <label className="block text-sm" htmlFor={id}>
      <span className="mb-1 block font-medium">{label}</span>
      <input
        ref={inputRef}
        id={id}
        name="slug"
        required
        dir="ltr"
        pattern={pattern}
        maxLength={maxLength}
        value={slug}
        aria-describedby={`${id}-hint`}
        data-testid={testId}
        onChange={(e) => {
          touched.current = true;
          setSlug(e.target.value.toLowerCase());
        }}
        className={`${inputCls} w-full`}
      />
      <span id={`${id}-hint`} className="mt-1 block text-xs text-on-cream-muted">
        {hint}
        {isNew ? " يُقترح تلقائياً من العنوان، ويمكنك تعديله." : " تغييره يغيّر رابط الصفحة المنشورة."}
      </span>
    </label>
  );
}
