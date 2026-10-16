"use client";

import { goToLogin } from "@/features/portal/client-nav";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Lightbox, type LightboxItem } from "@/components/media/gallery/Lightbox";
import { saveSelectionNote, submitSelection, toggleSelection } from "@/features/album-selections/actions";
import { loadGalleryPage, signGalleryUrls } from "@/features/galleries/actions";
import type { GalleryItem, GalleryPage } from "@/features/galleries/data";

type SaveState = "saving" | "saved" | "error";

export type SelectionProps = {
  status: "draft" | "submitted" | "locked";
  count: number;
  items: Record<string, string | null>;
};


export function EventGallery({
  eventId,
  initial,
  mode,
  selection,
}: {
  eventId: string;
  initial: GalleryPage;
  mode: "view" | "select";
  selection?: SelectionProps;
}) {
  const selectable = mode === "select";
  const [locked, setLocked] = useState(selection ? selection.status !== "draft" : true);
  const [items, setItems] = useState<GalleryItem[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [nextOffset, setNextOffset] = useState<number | null>(initial.nextOffset);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [review, setReview] = useState(false);
  const [selected, setSelected] = useState<Record<string, string | null>>(selection?.items ?? {});
  const [count, setCount] = useState(selection?.count ?? 0);
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [intents, setIntents] = useState<Record<string, boolean>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [display, setDisplay] = useState<Record<string, { url: string | null; exp: number | null }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Focus follows the confirm row (its buttons replace the one that was pressed).
  const focusNext = useRef(false);
  const focusOnMount = (el: HTMLButtonElement | null) => {
    if (el && focusNext.current) {
      focusNext.current = false;
      el.focus();
    }
  };

  const listReq = useRef(0);
  const toggleSeq = useRef<Record<string, number>>({});
  const sentinel = useRef<HTMLDivElement>(null);
  const filtered = selectedOnly || review;

  // ---------------------------------------------------------------- paging
  const fetchPage = useCallback(
    async (offset: number, reset: boolean, onlySelected: boolean) => {
      const req = ++listReq.current;
      setLoading(true);
      setLoadError(null);
      const res = await loadGalleryPage(eventId, offset, onlySelected).catch(() => null);
      if (req !== listReq.current) return; // stale (filter changed meanwhile)
      setLoading(false);
      if (!res) return setLoadError("تعذّر الاتصال. تحقّق من الشبكة وحاول مجدداً.");
      if (!res.ok) {
        if (res.code === "auth") return goToLogin();
        return setLoadError(res.error);
      }
      setItems((prev) => {
        if (reset) return res.data.items;
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...res.data.items.filter((i) => !seen.has(i.id))];
      });
      setTotal(res.data.total);
      setNextOffset(res.data.nextOffset);
    },
    [eventId],
  );

  const switchFilter = useCallback(
    (onlySelected: boolean) => {
      setItems([]);
      setNextOffset(null);
      setLightbox(null);
      void fetchPage(0, true, onlySelected);
    },
    [fetchPage],
  );

  useEffect(() => {
    const el = sentinel.current;
    if (!el || nextOffset === null || loading || loadError) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchPage(nextOffset, false, filtered);
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextOffset, loading, loadError, fetchPage, filtered]);

  // ---------------------------------------------------------------- selection
  async function setPick(id: string, want: boolean) {
    if (locked) return;
    const seq = (toggleSeq.current[id] ?? 0) + 1;
    toggleSeq.current[id] = seq;
    const before = selected[id];
    const had = id in selected;
    setSelected((s) => {
      const n = { ...s };
      if (want) n[id] = s[id] ?? null;
      else delete n[id];
      return n;
    });
    setSaves((s) => ({ ...s, [id]: "saving" }));
    setIntents((s) => ({ ...s, [id]: want }));
    const res = await toggleSelection(eventId, id, want).catch(() => null);
    if (toggleSeq.current[id] !== seq) return; // a newer toggle on this photo superseded us
    if (res?.ok) {
      setCount(res.data.count);
      setSaves((s) => ({ ...s, [id]: "saved" }));
      return;
    }
    if (res && res.code === "auth") return goToLogin();
    if (res && res.code === "locked") setLocked(true);
    // revert to last confirmed state
    setSelected((s) => {
      const n = { ...s };
      if (had) n[id] = before ?? null;
      else delete n[id];
      return n;
    });
    setSaves((s) => ({ ...s, [id]: "error" }));
    setBanner(res?.error ?? "تعذّر الحفظ. تحقّق من الاتصال وحاول مرة أخرى.");
  }

  const [noteSaves, setNoteSaves] = useState<Record<string, SaveState>>({});
  async function saveNote(id: string, note: string) {
    setNoteSaves((s) => ({ ...s, [id]: "saving" }));
    const res = await saveSelectionNote(eventId, id, note).catch(() => null);
    if (res?.ok) {
      setSelected((s) => (id in s ? { ...s, [id]: note.trim() || null } : s));
      setNoteSaves((s) => ({ ...s, [id]: "saved" }));
    } else {
      if (res?.code === "auth") return goToLogin();
      if (res?.code === "locked") setLocked(true);
      setNoteSaves((s) => ({ ...s, [id]: "error" }));
      setBanner(res?.error ?? "تعذّر حفظ الملاحظة.");
    }
  }

  async function submit() {
    setSubmitting(true);
    setBanner(null);
    const res = await submitSelection(eventId).catch(() => null);
    setSubmitting(false);
    setConfirming(false);
    if (res?.ok) {
      setLocked(true);
      return;
    }
    if (res?.code === "auth") return goToLogin();
    if (res?.code === "locked") setLocked(true);
    setBanner(res?.error ?? "تعذّر إرسال الاختيار الآن. حاول مرة أخرى.");
  }

  // ---------------------------------------------------------------- lightbox
  const lbItems: LightboxItem[] = useMemo(
    () =>
      items.map((it, i) => ({
        id: it.id,
        src: display[it.id]?.url ?? null,
        width: it.width,
        height: it.height,
        alt: `صورة ${i + 1}`,
      })),
    [items, display],
  );

  useEffect(() => {
    if (lightbox === null) return;
    const want = [lightbox - 1, lightbox, lightbox + 1]
      .map((i) => items[i]?.id)
      .filter((id): id is string => Boolean(id))
      .filter((id) => {
        const d = display[id];
        return !d || (d.exp !== null && d.exp - Date.now() < 30_000);
      });
    if (!want.length) return;
    let alive = true;
    void signGalleryUrls(want, "display").then((res) => {
      if (!alive || !res.ok) return;
      setDisplay((d) => {
        const n = { ...d };
        for (const r of res.data) n[r.id] = { url: r.url, exp: r.expiresAt };
        return n;
      });
    });
    return () => {
      alive = false;
    };
  }, [lightbox, items, display]);

  const refreshedTiles = useRef<Set<string>>(new Set());
  async function onTileError(id: string) {
    if (refreshedTiles.current.has(id)) {
      setItems((prev) => prev.map((p) => (p.id === id ? { ...p, src: null } : p)));
      return;
    }
    refreshedTiles.current.add(id);
    const res = await signGalleryUrls([id], "thumb").catch(() => null);
    const url = res?.ok ? (res.data[0]?.url ?? null) : null;
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, src: url, expiresAt: res?.ok ? res.data[0]?.expiresAt ?? null : null } : p)));
  }

  const current = lightbox !== null ? items[lightbox] : null;
  const shownTotal = filtered ? total : total;

  return (
    <div>
      {selectable ? (
        <div className="sticky top-0 z-20 -mx-[var(--gutter)] mb-6 border-b border-cream-line bg-cream/95 px-[var(--gutter)] py-3 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-lg font-semibold" aria-live="polite">
              اخترت <span data-testid="selection-count">{count}</span> صورة
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {!review ? (
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border border-cream-line px-3">
                  <input
                    type="checkbox"
                    checked={selectedOnly}
                    onChange={(e) => {
                      setSelectedOnly(e.target.checked);
                      switchFilter(e.target.checked);
                    }}
                  />
                  المختارة فقط
                </label>
              ) : null}
              <button
                type="button"
                className="min-h-11 rounded-sm border border-on-cream/30 px-4 hover:border-gold"
                onClick={() => {
                  const next = !review;
                  setReview(next);
                  setSelectedOnly(false);
                  switchFilter(next);
                }}
              >
                {review ? "العودة إلى كل الصور" : locked ? "عرض الاختيار المُرسل" : "مراجعة وإرسال"}
              </button>
            </div>
          </div>
          {banner ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {banner}{" "}
              <button type="button" className="underline" onClick={() => setBanner(null)}>
                إخفاء
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      {review && selectable ? (
        <div className="mb-6 rounded-md border border-cream-line bg-cream-2 p-5">
          {locked ? (
            <p data-testid="selection-locked">تم إرسال اختيارك إلى الاستوديو، ولم يعد قابلاً للتعديل.</p>
          ) : confirming ? (
            <div className="flex flex-wrap items-center gap-3">
              <p>سيتم إرسال {count} صورة ولن تتمكن من تعديل الاختيار بعدها. هل أنت متأكد؟</p>
              <button
                type="button"
                className="min-h-11 rounded-sm bg-gold px-6 font-medium text-ink hover:bg-gold-press disabled:opacity-60"
                onClick={submit}
                disabled={submitting}
                ref={focusOnMount}
              >
                {submitting ? "جارِ الإرسال…" : "تأكيد الإرسال"}
              </button>
              <button
                type="button"
                className="min-h-11 px-3 underline"
                onClick={() => {
                  focusNext.current = true;
                  setConfirming(false);
                }}
              >
                تراجع
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>راجع الصور المختارة وأضف ملاحظاتك، ثم أرسل الاختيار للاستوديو.</p>
              <button
                type="button"
                className="min-h-11 rounded-sm bg-gold px-6 font-medium text-ink hover:bg-gold-press disabled:opacity-60"
                onClick={() => {
                  focusNext.current = true;
                  setConfirming(true);
                }}
                disabled={count === 0}
                ref={focusOnMount}
              >
                إرسال الاختيار
              </button>
            </div>
          )}
        </div>
      ) : null}

      {items.length === 0 && !loading && !loadError ? (
        <div role="status" className="rounded-md border border-dashed border-cream-line px-6 py-12 text-center">
          <p className="font-display text-xl font-semibold">
            {filtered ? "لم تختر أي صورة بعد" : "لا توجد صور بعد"}
          </p>
          <p className="mt-2 text-on-cream-muted">
            {filtered ? "اضغط على «اختيار» أسفل أي صورة لإضافتها." : "ستظهر الصور هنا فور تجهيزها من الاستوديو."}
          </p>
        </div>
      ) : null}

      <ul
        className={review ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "grid grid-cols-2 gap-2 sm:grid-cols-3 md:gap-3 lg:grid-cols-4 xl:grid-cols-6"}
        data-testid="gallery-grid"
        aria-label={`الصور (${shownTotal})`}
      >
        {items.map((it, i) => {
          const isSel = it.id in selected;
          const st = saves[it.id];
          return (
            <li key={it.id} data-testid="gallery-tile" className={review ? "rounded-md bg-cream-2 p-3" : ""}>
              <div className="group relative overflow-hidden rounded-sm bg-cream-line/60" style={{ aspectRatio: it.width && it.height ? `${it.width} / ${it.height}` : "3 / 2" }}>
                <button
                  type="button"
                  className="absolute inset-0 block h-full w-full"
                  onClick={() => setLightbox(i)}
                  aria-label={`عرض الصورة ${i + 1}`}
                >
                  {it.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.src}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={() => onTileError(it.id)}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-xs text-on-cream-muted">المعاينة غير متاحة</span>
                  )}
                </button>
                {selectable ? (
                  <button
                    type="button"
                    aria-pressed={isSel}
                    disabled={locked}
                    onClick={() => setPick(it.id, !isSel)}
                    data-testid="select-toggle"
                    className={`absolute bottom-2 start-2 min-h-9 rounded-sm px-3 text-sm font-medium shadow transition-colors disabled:cursor-default ${
                      isSel ? "bg-gold text-ink" : "bg-ink/75 text-on-dark hover:bg-ink"
                    }`}
                  >
                    {isSel ? "✓ مختارة" : "اختيار"}
                    <span className="sr-only"> الصورة {i + 1}</span>
                  </button>
                ) : null}
                {selectable && st ? (
                  <span className="absolute end-2 top-2 rounded-sm bg-ink/75 px-2 py-0.5 text-xs text-on-dark" data-save-state={st}>
                    {st === "saving" ? "جارِ الحفظ…" : st === "saved" ? "محفوظ" : (
                      <button type="button" className="underline" onClick={() => setPick(it.id, intents[it.id] ?? !isSel)}>
                        لم يُحفظ — أعد المحاولة
                      </button>
                    )}
                  </span>
                ) : null}
              </div>
              {review && selectable ? (
                <NoteField
                  key={`${it.id}-note`}
                  initial={selected[it.id] ?? ""}
                  disabled={locked || !isSel}
                  state={noteSaves[it.id]}
                  onSave={(v) => saveNote(it.id, v)}
                />
              ) : null}
            </li>
          );
        })}
        {loading && items.length === 0
          ? Array.from({ length: 12 }, (_, i) => (
              <li key={`sk-${i}`} aria-hidden="true" className="aspect-[3/2] animate-pulse rounded-sm bg-cream-line/70" />
            ))
          : null}
      </ul>

      <div ref={sentinel} className="mt-6 flex min-h-16 flex-col items-center justify-center gap-3 text-center">
        {loadError ? (
          <div role="alert" className="text-danger">
            <p>{loadError}</p>
            <button
              type="button"
              className="mt-2 min-h-11 rounded-sm border border-danger/50 px-4"
              onClick={() => fetchPage(nextOffset ?? 0, nextOffset === null, filtered)}
            >
              إعادة المحاولة
            </button>
          </div>
        ) : nextOffset !== null ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => fetchPage(nextOffset, false, filtered)}
            className="min-h-11 rounded-sm border border-on-cream/30 px-6 disabled:opacity-60"
          >
            {loading ? "جارِ تحميل المزيد…" : "تحميل المزيد"}
          </button>
        ) : items.length > 0 ? (
          <p className="text-sm text-on-cream-muted" data-testid="gallery-end">
            عرضت كل الصور ({items.length})
          </p>
        ) : null}
      </div>

      {lightbox !== null && current ? (
        <Lightbox
          items={lbItems}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
          status={display[current.id] ? (display[current.id].url ? "ready" : "error") : "loading"}
          actions={
            selectable && !locked ? (
              <button
                type="button"
                aria-pressed={current.id in selected}
                onClick={() => setPick(current.id, !(current.id in selected))}
                className={`min-h-11 rounded-sm px-4 font-medium ${current.id in selected ? "bg-gold text-ink" : "border border-ink-line"}`}
              >
                {current.id in selected ? "✓ مختارة" : "اختيار"}
              </button>
            ) : null
          }
        />
      ) : null}
    </div>
  );
}

function NoteField({
  initial,
  disabled,
  state,
  onSave,
}: {
  initial: string;
  disabled: boolean;
  state?: SaveState;
  onSave: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const dirty = value !== initial;
  const id = useId();
  return (
    <div className="mt-3">
      <label htmlFor={id} className="mb-1 block text-sm text-on-cream-muted">ملاحظة على الصورة (اختياري)</label>
      <textarea
        id={id}
        className="field min-h-20"
        maxLength={1000}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="mt-1 flex items-center gap-3 text-sm">
        <button
          type="button"
          disabled={disabled || (!dirty && state !== "error") || state === "saving"}
          onClick={() => onSave(value)}
          className="min-h-9 rounded-sm border border-on-cream/30 px-3 disabled:opacity-50"
        >
          حفظ الملاحظة
        </button>
        <span aria-live="polite" className={state === "error" ? "text-danger" : "text-on-cream-muted"}>
          {state === "saving" ? "جارِ الحفظ…" : state === "saved" && !dirty ? "تم الحفظ" : state === "error" ? "لم تُحفظ" : ""}
        </span>
      </div>
    </div>
  );
}
