"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/features/admin/result";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
export type SortItem = { id: string; content: ReactNode };

const iconBtn =
  "inline-flex min-h-10 min-w-10 items-center justify-center rounded-sm border border-cream-line bg-[#fffdf8] text-sm hover:border-on-cream-muted disabled:opacity-40";

/**
 * Reorderable list: drag the handle (pointer events = mouse + touch + pen) or use the ↑/↓ buttons
 * (keyboard accessible). Every change is saved immediately through `action` with `order` = ids in order.
 */
export function SortableList({
  items,
  action,
  table,
  label,
  testId,
}: {
  items: SortItem[];
  action: Action;
  table?: string;
  label: string;
  testId?: string;
}) {
  const [order, setOrder] = useState(items.map((i) => i.id));
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const byId = new Map(items.map((i) => [i.id, i]));
  // Server re-render with a different set of items resets local order.
  const sig = items.map((i) => i.id).join(",");
  const [seen, setSeen] = useState(sig);
  if (seen !== sig) {
    setSeen(sig);
    setOrder(items.map((i) => i.id));
  }

  function save(next: string[]) {
    const prev = order;
    setOrder(next);
    const fd = new FormData();
    if (table) fd.set("table", table);
    for (const id of next) fd.append("order", id);
    start(async () => {
      const r = await action({ ok: true, message: "" }, fd);
      setMsg(r);
      if (!r.ok) setOrder(prev);
    });
  }

  function move(id: string, dir: -1 | 1) {
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragId || !listRef.current) return;
    const rows = Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-sort-id]"));
    const over = rows.find((r) => {
      const b = r.getBoundingClientRect();
      return e.clientY >= b.top && e.clientY <= b.bottom;
    });
    const overId = over?.dataset.sortId;
    if (!overId || overId === dragId) return;
    setOrder((cur) => {
      const next = cur.filter((x) => x !== dragId);
      next.splice(cur.indexOf(overId), 0, dragId);
      return next;
    });
  }

  function endDrag() {
    if (!dragId) return;
    setDragId(null);
    if (order.join(",") !== items.map((i) => i.id).join(",")) save(order);
  }

  return (
    <div data-testid={testId}>
      <ol ref={listRef} aria-label={label} className="space-y-2" onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {order.map((id, idx) => {
          const it = byId.get(id);
          if (!it) return null;
          return (
            <li
              key={id}
              data-sort-id={id}
              data-testid="sort-row"
              className={`flex items-start gap-2 rounded-md border bg-[#fffdf8] p-2 ${dragId === id ? "border-gold shadow-md" : "border-cream-line"}`}
            >
              <button
                type="button"
                aria-label="اسحب لتغيير الترتيب"
                className={`${iconBtn} cursor-grab touch-none select-none`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                  setDragId(id);
                }}
              >
                ⋮⋮
              </button>
              <div className="min-w-0 flex-1">{it.content}</div>
              <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                <button type="button" className={iconBtn} disabled={pending || idx === 0} onClick={() => move(id, -1)} aria-label="نقل للأعلى">
                  ↑
                </button>
                <button type="button" className={iconBtn} disabled={pending || idx === order.length - 1} onClick={() => move(id, 1)} aria-label="نقل للأسفل">
                  ↓
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm">
        {pending ? <span className="text-on-cream-muted">جارٍ حفظ الترتيب…</span> : msg?.message ? <span data-testid="order-msg" data-ok={msg.ok ? "1" : "0"} className={msg.ok ? "text-success" : "text-danger"}>{msg.message}</span> : null}
      </p>
    </div>
  );
}
