"use client";

import { useState } from "react";
import { suggestSlug } from "./schema";

export type PickPhoto = { id: string; album: string };

const fieldCls = "field !min-h-10 !py-1.5 text-sm";

/** Pick one published album photo (thumbnails via /p/<id>/thumb). Empty = none. */
export function PhotoPicker({ name, label, photos, defaultValue }: { name: string; label: string; photos: PickPhoto[]; defaultValue?: string | null }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const albums = Array.from(new Set(photos.map((p) => p.album)));
  const [album, setAlbum] = useState(albums[0] ?? "");
  return (
    <fieldset className="text-sm" data-testid={`picker-${name}`}>
      <legend className="mb-1 font-medium">{label}</legend>
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-wrap items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/p/${value}/thumb`} alt="الصورة المختارة" className="h-20 w-28 rounded-sm border border-cream-line object-cover" />
        ) : (
          <span className="flex h-20 w-28 items-center justify-center rounded-sm border border-dashed border-cream-line text-xs text-on-cream-muted">بدون صورة</span>
        )}
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-h-10 rounded-sm border border-cream-line bg-[#fffdf8] px-3">
          {open ? "إغلاق" : "اختيار صورة"}
        </button>
        {value ? (
          <button
            type="button"
            onClick={(e) => {
              setValue("");
              e.currentTarget.form?.dispatchEvent(new Event("change", { bubbles: true }));
            }}
            className="min-h-10 px-2 text-danger underline"
          >
            إزالة
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-3 rounded-md border border-cream-line p-2">
          {photos.length ? (
            <>
              <label className="mb-2 block">
                <span className="sr-only">الألبوم</span>
                <select value={album} onChange={(e) => setAlbum(e.target.value)} className={fieldCls}>
                  {albums.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
              <ul className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
                {photos
                  .filter((p) => p.album === album)
                  .map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-pressed={value === p.id}
                        onClick={(e) => {
                          setValue(p.id);
                          setOpen(false);
                          e.currentTarget.form?.dispatchEvent(new Event("change", { bubbles: true }));
                        }}
                        className={`block w-full overflow-hidden rounded-sm border-2 ${value === p.id ? "border-gold" : "border-transparent"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/p/${p.id}/thumb`} alt={`صورة من ${p.album}`} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <p className="text-on-cream-muted">لا توجد صور منشورة بعد. أضف صوراً من «ألبومات الصور».</p>
          )}
        </div>
      ) : null}
    </fieldset>
  );
}

/** Slug with suggestion from a Latin hint (or the title when it is Latin). */
export function SlugField({ defaultValue, prefix }: { defaultValue?: string; prefix: string }) {
  const [slug, setSlug] = useState(defaultValue ?? "");
  const [hint, setHint] = useState("");
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">اسم بالإنجليزي للرابط (اختياري)</span>
        <input
          value={hint}
          dir="ltr"
          maxLength={80}
          onChange={(e) => {
            setHint(e.target.value);
            if (!defaultValue) setSlug(suggestSlug(e.target.value));
          }}
          placeholder="wedding photography"
          className={fieldCls}
          data-testid="slug-hint"
        />
        <span className="mt-1 block text-xs text-on-cream-muted">نقترح الرابط تلقائياً من الكلمات الإنجليزية.</span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">الرابط المختصر</span>
        <input
          name="slug"
          required
          dir="ltr"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          minLength={2}
          maxLength={60}
          className={fieldCls}
        />
        <span className="mt-1 block text-xs text-on-cream-muted" dir="ltr">
          {prefix}/{slug || "…"}
        </span>
        {defaultValue && slug !== defaultValue ? (
          <span className="mt-1 block text-xs text-gold-press">سيُحوَّل الرابط القديم تلقائياً للجديد.</span>
        ) : null}
      </label>
    </div>
  );
}

/** Editable list of short lines (offer items). Posts each as `items`. */
export function ItemsEditor({ defaultValue = [], max = 20, legend = "ماذا يشمل العرض؟ (بنود)" }: { defaultValue?: string[]; max?: number; legend?: string }) {
  const [rows, setRows] = useState(() => (defaultValue.length ? defaultValue : [""]).map((v, i) => ({ k: i, v })));
  const [next, setNext] = useState(rows.length);
  const btn = "min-h-10 min-w-10 rounded-sm border border-cream-line bg-[#fffdf8] text-sm disabled:opacity-40";
  const swap = (i: number, j: number) =>
    setRows((r) => {
      if (j < 0 || j >= r.length) return r;
      const n = [...r];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  return (
    <fieldset className="text-sm" data-testid="items-editor">
      <legend className="mb-1 font-medium">{legend}</legend>
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.k} className="flex gap-1">
            <input
              name="items"
              aria-label={`البند ${i + 1}`}
              maxLength={120}
              defaultValue={r.v}
              className={`${fieldCls} flex-1`}
            />
            <button type="button" className={btn} aria-label="أعلى" disabled={i === 0} onClick={() => swap(i, i - 1)}>
              ↑
            </button>
            <button type="button" className={btn} aria-label="أسفل" disabled={i === rows.length - 1} onClick={() => swap(i, i + 1)}>
              ↓
            </button>
            <button type="button" className={`${btn} text-danger`} aria-label="حذف البند" onClick={() => setRows((x) => x.filter((y) => y.k !== r.k))}>
              ×
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        disabled={rows.length >= max}
        onClick={() => {
          setRows((x) => [...x, { k: next, v: "" }]);
          setNext((n) => n + 1);
        }}
        className="mt-2 min-h-10 rounded-sm border border-cream-line bg-[#fffdf8] px-3"
      >
        + إضافة بند
      </button>
    </fieldset>
  );
}

/** Link-kind switch for announcements: shows the offer or page select only when relevant. */
export function LinkPicker({
  offers,
  pages,
  defaults,
}: {
  offers: { id: string; title: string }[];
  pages: { key: string; label: string }[];
  defaults: { kind: string; offer: string | null; page: string | null };
}) {
  const [kind, setKind] = useState(defaults.kind || "none");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">الرابط</span>
        <select name="link_kind" value={kind} onChange={(e) => setKind(e.target.value)} className={fieldCls}>
          <option value="none">بدون رابط</option>
          <option value="offer">عرض</option>
          <option value="page">صفحة من الموقع</option>
        </select>
      </label>
      {kind === "offer" ? (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">العرض</span>
          <select name="link_offer_id" defaultValue={defaults.offer ?? ""} required className={fieldCls}>
            <option value="">— اختر —</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {kind === "page" ? (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">الصفحة</span>
          <select name="link_page" defaultValue={defaults.page ?? ""} required className={fieldCls}>
            <option value="">— اختر —</option>
            {pages.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
