"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/features/admin/result";
import { MenuSeparator, RowMenu } from "@/features/admin/RowMenu";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
/** menu: the row's other actions; with it the ↑/↓ live in that «⋯» menu under «تغيير الترتيب». menuLabel names the row. */
export type SortItem = { id: string; content: ReactNode; menu?: ReactNode; menuLabel?: string; trailing?: ReactNode };

const iconBtn =
  "inline-flex min-h-10 min-w-12 items-center justify-center rounded-lg border border-cream-line bg-[#fffdf8] text-base hover:border-on-cream-muted disabled:opacity-40";

/**
 * Reorderable list: drag the handle (pointer events = mouse + touch + pen), press ↑/↓ on the focused handle, or use
 * «نقل للأعلى / للأسفل» (in the row's «⋯» menu when it has one). Every change is saved immediately through `action`
 * with `order` = ids in order.
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
              className={`flex items-center gap-3 rounded-xl border bg-[#fffdf8] px-3 py-3 shadow-[0_6px_18px_-16px_rgb(60_45_20/0.5)] md:px-4 ${dragId === id ? "border-gold shadow-md" : "border-cream-line"}`}
            >
              <button
                type="button"
                aria-label="اسحب لتغيير الترتيب، أو استخدم السهمين للأعلى والأسفل"
                className="inline-flex size-10 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-lg text-on-cream-muted hover:bg-cream-2 hover:text-on-cream"
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                  setDragId(id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    move(id, e.key === "ArrowUp" ? -1 : 1);
                  }
                }}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">{it.content}</div>
              {it.trailing}
              {it.menu ? (
                <RowMenu label={`إجراءات: ${it.menuLabel ?? ""}`.trim()}>
                  {it.menu}
                  <MenuSeparator />
                  <div className="px-3 pt-1 pb-2">
                    <p className="mb-2 flex items-center gap-2 text-on-cream">
                      <span aria-hidden="true" className="text-on-cream-muted">↕</span>تغيير الترتيب
                    </p>
                    <div className="flex gap-2">
                      <button type="button" className={iconBtn} disabled={pending || idx === 0} onClick={() => move(id, -1)} aria-label="نقل للأعلى">↑</button>
                      <button type="button" className={iconBtn} disabled={pending || idx === order.length - 1} onClick={() => move(id, 1)} aria-label="نقل للأسفل">↓</button>
                    </div>
                  </div>
                </RowMenu>
              ) : (
                <div className="sr-only focus-within:not-sr-only focus-within:flex focus-within:gap-1">
                  <button type="button" className={iconBtn} disabled={pending || idx === 0} onClick={() => move(id, -1)} aria-label="نقل للأعلى">↑</button>
                  <button type="button" className={iconBtn} disabled={pending || idx === order.length - 1} onClick={() => move(id, 1)} aria-label="نقل للأسفل">↓</button>
                </div>
              )}
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
