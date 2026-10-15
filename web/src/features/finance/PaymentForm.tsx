"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import type { ActionResult } from "@/features/admin/result";
import { recordPayment } from "./actions";

const cls = "field !min-h-10 !py-1.5 text-sm";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * Payment/refund form. The idempotency key is created once per form instance,
 * so a double submit or a retry after a network error cannot record twice.
 * After a confirmed new record a fresh key is issued for the next payment.
 */
export function PaymentForm({
  customers,
  events,
}: {
  customers: { id: string; full_name: string }[];
  events: { id: string; title: string; customer_id: string }[];
}) {
  const [key, setKey] = useState("");
  const [customer, setCustomer] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, fd) => {
    const r = await recordPayment(prev, fd);
    if (r.ok && r.data?.replay === false) {
      // Confirmed new record: clear the form and issue a key for the next payment.
      formRef.current?.reset();
      setCustomer("");
      setKey(newKey());
    }
    return r;
  }, { ok: true, message: "" });

  // The key is random, so it is created on the client only (avoids a hydration mismatch).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-only init
  useEffect(() => setKey(newKey()), []);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3" data-testid="payment-form">
      <input type="hidden" name="idempotency_key" value={key} data-testid="idem-key" />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">العميل</span>
          <select name="customer_id" required value={customer} onChange={(e) => setCustomer(e.target.value)} className={cls}>
            <option value="" disabled>اختر العميل</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">المناسبة (اختياري)</span>
          <select name="event_id" defaultValue="" className={cls}>
            <option value="">بدون</option>
            {events.filter((e) => e.customer_id === customer).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">المبلغ (₪)</span>
          <input name="amount" required inputMode="decimal" dir="ltr" placeholder="1500.00" className={cls} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">النوع</span>
          <select name="kind" defaultValue="payment" className={cls}>
            <option value="payment">دفعة</option>
            <option value="refund">استرداد</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">طريقة الدفع</span>
          <select name="method" defaultValue="cash" className={cls}>
            <option value="cash">نقداً</option>
            <option value="bank_transfer">تحويل بنكي</option>
            <option value="cheque">شيك</option>
            <option value="card">بطاقة</option>
            <option value="other">أخرى</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">تاريخ الاستلام</span>
          <input name="received_at" type="date" className={cls} />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">مرجع (رقم شيك/حوالة)</span>
          <input name="reference" maxLength={200} className={cls} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !key} className="inline-flex min-h-10 items-center rounded-sm bg-gold px-4 text-sm font-medium text-ink hover:bg-gold-press disabled:opacity-50">
          {pending ? "جارٍ التسجيل…" : "تسجيل"}
        </button>
        {state.message ? (
          <p role={state.ok ? "status" : "alert"} data-testid="action-msg" className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
