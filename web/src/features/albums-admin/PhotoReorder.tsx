"use client";

import { useState, useTransition } from "react";
import { reorderPhotos } from "./actions";

export type ReorderItem = { id: string; thumb: string | null; label: string };

/** Drag & drop (pointer) + keyboard-accessible buttons; saves the whole order in one action. */
export function PhotoReorder({ albumId, items }: { albumId: string; items: ReorderItem[] }) {
  const [order, setOrder] = useState(items);
  const [drag, setDrag] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const dirty = order.some((o, i) => o.id !== items[i]?.id);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((o) => {
      const n = [...o];
      const [x] = n.splice(from, 1);
      n.splice(to, 0, x);
      return n;
    });
    setMsg("");
  };

  return (
    <div data-testid="photo-reorder">
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="ترتيب الصور">
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
              <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`تقديم ${p.label}`} className="min-h-8 min-w-8 rounded-sm border border-cream-line disabled:opacity-40">
                ↑
              </button>
              <span>{i + 1}</span>
              <button type="button" onClick={() => move(i, i + 1)} disabled={i === order.length - 1} aria-label={`تأخير ${p.label}`} className="min-h-8 min-w-8 rounded-sm border border-cream-line disabled:opacity-40">
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!dirty || pending}
          data-testid="photo-reorder-save"
          onClick={() =>
            start(async () => {
              const r = await reorderPhotos(albumId, order.map((o) => o.id));
              setMsg(r.message);
            })
          }
          className="inline-flex min-h-10 items-center rounded-sm bg-gold px-4 text-sm font-medium text-ink hover:bg-gold-press disabled:opacity-50"
        >
          {pending ? "جارٍ الحفظ…" : "حفظ الترتيب"}
        </button>
        {dirty ? <span className="text-xs text-on-cream-muted">تغييرات غير محفوظة</span> : null}
        {msg ? (
          <span role="status" className="text-sm">
            {msg}
          </span>
        ) : null}
      </div>
    </div>
  );
}
