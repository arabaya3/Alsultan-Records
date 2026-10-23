"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { arNum } from "@/features/public-content/labels";
import { reorderPhotos } from "./actions";

export type ReorderItem = { id: string; thumb: string | null; label: string };

/**
 * Order of the album's photos: drag & drop (pointer) AND keyboard/touch buttons «تقديم/تأخير» (44px targets), which
 * keep focus on the moved photo and announce its new position. Nothing is saved until «حفظ الترتيب» (one action);
 * leaving with unsaved changes asks first.
 */
export function PhotoReorder({ albumId, items }: { albumId: string; items: ReorderItem[] }) {
  const router = useRouter();
  const [order, setOrder] = useState(items);
  const [drag, setDrag] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [announce, setAnnounce] = useState("");
  const [pending, start] = useTransition();
  const focusAfter = useRef<{ id: string; dir: "up" | "down" } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const dirty = order.some((o, i) => o.id !== items[i]?.id);

  useEffect(() => {
    const f = focusAfter.current;
    if (!f) return;
    focusAfter.current = null;
    const li = listRef.current?.querySelector<HTMLElement>(`[data-photo-id="${CSS.escape(f.id)}"]`);
    const btn = li?.querySelector<HTMLButtonElement>(`[data-move="${f.dir}"]:not([disabled])`) ?? li?.querySelector<HTMLButtonElement>("[data-move]:not([disabled])");
    btn?.focus();
  }, [order]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const move = (from: number, to: number, viaKeyboard = false) => {
    if (to < 0 || to >= order.length || from === to) return;
    const moved = order[from];
    setOrder((o) => {
      const n = [...o];
      const [x] = n.splice(from, 1);
      n.splice(to, 0, x);
      return n;
    });
    if (viaKeyboard) focusAfter.current = { id: moved.id, dir: to < from ? "up" : "down" };
    setAnnounce(`${moved.label}: الموضع ${arNum(to + 1)} من ${arNum(order.length)}`);
    setMsg("");
  };

  return (
    <div data-testid="photo-reorder">
      <p className="mb-2 text-sm text-on-cream-muted">اسحب الصورة إلى مكانها، أو استخدم «تقديم» و«تأخير»، ثم اضغط «حفظ الترتيب».</p>
      <ol ref={listRef} className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6" aria-label="ترتيب الصور">
        {order.map((p, i) => (
          <li
            key={p.id}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag !== null) move(drag, i);
              setDrag(null);
            }}
            data-photo-id={p.id}
            className={`cursor-grab rounded-sm border p-1 text-center text-xs ${drag === i ? "border-gold" : "border-cream-line"}`}
          >
            {p.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img src={p.thumb} alt="" className="aspect-square w-full rounded-sm bg-cream-2 object-cover" draggable={false} />
            ) : (
              <div className="aspect-square w-full rounded-sm bg-cream-2" />
            )}
            <div className="mt-1 flex items-center justify-between gap-1">
              <button
                type="button"
                data-move="up"
                onClick={(e) => move(i, i - 1, e.detail === 0)}
                disabled={i === 0}
                aria-label={`تقديم ${p.label} (الموضع ${arNum(i + 1)})`}
                className="min-h-11 min-w-11 rounded-sm border border-cream-line hover:border-gold disabled:opacity-40"
              >
                <span aria-hidden="true">↑</span>
              </button>
              <span className="text-sm font-semibold">{arNum(i + 1)}</span>
              <button
                type="button"
                data-move="down"
                onClick={(e) => move(i, i + 1, e.detail === 0)}
                disabled={i === order.length - 1}
                aria-label={`تأخير ${p.label} (الموضع ${arNum(i + 1)})`}
                className="min-h-11 min-w-11 rounded-sm border border-cream-line hover:border-gold disabled:opacity-40"
              >
                <span aria-hidden="true">↓</span>
              </button>
            </div>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!dirty || pending}
          data-testid="photo-reorder-save"
          onClick={() =>
            start(async () => {
              const r = await reorderPhotos(albumId, order.map((o) => o.id));
              setMsg(r.message);
              router.refresh();
            })
          }
          className="inline-flex min-h-11 items-center rounded-sm bg-gold px-4 text-sm font-medium text-ink hover:bg-gold-press disabled:opacity-50"
        >
          {pending ? "جارٍ الحفظ…" : "حفظ الترتيب"}
        </button>
        {dirty ? <span className="text-xs text-on-cream-muted">تغييرات غير محفوظة</span> : null}
        {msg ? (
          <span role="status" data-testid="photo-reorder-msg" className="text-sm">
            {msg}
          </span>
        ) : null}
      </div>
    </div>
  );
}
