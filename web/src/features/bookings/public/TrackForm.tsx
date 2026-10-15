"use client";

import { useActionState, useTransition, type FormEvent } from "react";
import { formatDateAr } from "@/features/public-content/labels";
import { trackBooking } from "./actions";
import type { TrackState } from "./schema";

const STATUS_LABEL: Record<string, { label: string; body: string }> = {
  new: { label: "وصلنا طلبك", body: "طلبك عندنا وسنتواصل معك قريباً." },
  contacted: { label: "تواصلنا معك", body: "تواصلنا بخصوص التفاصيل. إذا فاتك الاتصال، راسلنا." },
  quoted: { label: "أرسلنا لك عرضاً", body: "تجد العرض في بوابة العميل أو وصلك منا مباشرة." },
  confirmed: { label: "الحجز مؤكد", body: "موعدك مثبّت. نشوفك يوم المناسبة." },
  cancelled: { label: "أُلغي الطلب", body: "إذا كان هذا خطأ، تواصل معنا." },
  declined: { label: "تعذّر قبول الطلب", body: "نعتذر، لم نتمكن من تغطية هذا الموعد." },
};

export function TrackForm() {
  const [state, dispatch, isPending] = useActionState<TrackState, FormData>(trackBooking, { status: "idle" });
  const [, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  }

  const s = state.status === "found" ? (STATUS_LABEL[state.bookingStatus] ?? { label: state.bookingStatus, body: "" }) : null;

  return (
    <div className="grid gap-8">
      <form onSubmit={onSubmit} className="grid gap-6 sm:grid-cols-[1.4fr_1fr_auto] sm:items-end" aria-busy={isPending}>
        <div className="grid gap-2">
          <label htmlFor="code" className="font-medium">
            رمز المتابعة
          </label>
          <input id="code" name="code" required dir="ltr" autoComplete="off" autoCapitalize="characters" maxLength={20} className="field text-end uppercase tracking-widest" />
        </div>
        <div className="grid gap-2">
          <label htmlFor="last4" className="font-medium">
            آخر ٤ أرقام من هاتفك
          </label>
          <input id="last4" name="last4" required dir="ltr" inputMode="numeric" pattern="\d{4}" maxLength={4} className="field text-end tracking-widest" />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex min-h-12 items-center justify-center rounded-sm bg-gold px-8 font-medium text-ink hover:bg-gold-press disabled:opacity-60"
        >
          {isPending ? "جارِ البحث…" : "اعرض الحالة"}
        </button>
      </form>

      <div aria-live="polite">
        {state.status === "error" ? (
          <p role="alert" className="rounded-sm border border-danger/40 bg-danger/5 px-4 py-3 text-danger">
            {state.message}
          </p>
        ) : null}
        {state.status === "not_found" ? (
          <p className="rounded-sm border border-cream-line bg-cream-2 px-4 py-3">
            لم نجد طلباً بهذه البيانات. تأكد من الرمز وآخر أربعة أرقام من الهاتف المستخدم في الطلب.
          </p>
        ) : null}
        {state.status === "found" && s ? (
          <div className="rounded-md bg-ink p-8 text-on-dark">
            <p className="text-sm text-muted">حالة الطلب</p>
            <p className="mt-1 font-display text-3xl font-bold">
              {s.label}
              <span className="text-gold">.</span>
            </p>
            {s.body ? <p className="mt-3 text-muted">{s.body}</p> : null}
            {state.eventDate ? <p className="mt-4">تاريخ المناسبة: {formatDateAr(state.eventDate)}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
