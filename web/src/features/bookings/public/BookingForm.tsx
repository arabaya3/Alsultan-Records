"use client";

import Link from "next/link";
import Script from "next/script";
import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { EVENT_TYPE_OPTIONS } from "@/features/public-content/labels";
import { submitBooking } from "./actions";
import { SERVICE_OPTIONS, type BookingState, type FieldErrors } from "./schema";

const STEP1_FIELDS: (keyof FieldErrors)[] = ["contact_name", "contact_phone", "event_type", "event_date"];
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function Field({
  id,
  label,
  optional,
  error,
  children,
  hint,
}: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="font-medium">
        {label}
        {optional ? <span className="ms-2 text-sm font-normal text-on-cream-muted">(اختياري)</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-sm text-on-cream-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function BookingForm() {
  const [state, dispatch, isPending] = useActionState<BookingState, FormData>(submitBooking, {
    status: "idle",
  });
  const [, startTransition] = useTransition();
  const [step, setStep] = useState<1 | 2>(1);
  const [lastState, setLastState] = useState(state);
  const formRef = useRef<HTMLFormElement>(null);
  const step1Ref = useRef<HTMLFieldSetElement>(null);
  // One idempotency key per form instance; kept across retries so a resend never duplicates.
  const keyRef = useRef<string | null>(null);

  // If the server flags a step-1 field, bring the visitor back to step 1 (derived, no effect).
  if (state !== lastState) {
    setLastState(state);
    if (state.status === "error" && state.fieldErrors && STEP1_FIELDS.some((f) => state.fieldErrors?.[f])) {
      setStep(1);
    }
  }

  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const aria = (name: keyof FieldErrors) =>
    errors[name] ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` } : {};

  function goNext() {
    const inputs = step1Ref.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select");
    for (const el of Array.from(inputs ?? [])) {
      if (!el.checkValidity()) {
        el.reportValidity();
        return;
      }
    }
    setStep(2);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;
    if (step === 1) {
      goNext();
      return;
    }
    const fd = new FormData(e.currentTarget);
    keyRef.current ??= newKey();
    fd.set("idempotency_key", keyRef.current);
    // Dispatch manually (not via `action=`) so React does not reset the inputs on error.
    startTransition(() => dispatch(fd));
  }

  if (state.status === "success") {
    return (
      <div role="status" aria-live="polite" className="rounded-md bg-ink p-8 text-on-dark md:p-10">
        <h2 className="text-3xl font-bold">
          وصلنا طلبك<span className="text-gold">.</span>
        </h2>
        <p className="mt-3 text-lg text-muted">
          هذا استفسار وليس حجزاً مؤكداً بعد. سنتواصل معك لنتأكد من الموعد ونتفق على التفاصيل.
        </p>
        <p className="mt-8 text-sm text-muted">رمز المتابعة</p>
        <p dir="ltr" className="mt-1 text-end font-display text-4xl font-bold tracking-widest text-gold select-all">
          {state.trackingCode}
        </p>
        <p className="mt-3 text-muted">احتفظ بهذا الرمز. تقدر تتابع طلبك به مع آخر أربعة أرقام من هاتفك.</p>
        <div className="mt-8 flex flex-wrap items-center gap-6">
          <Link href="/track" className="inline-flex min-h-11 items-center rounded-sm bg-gold px-6 font-medium text-ink">
            تابع طلبك
          </Link>
          <Link href="/" className="underline decoration-1 underline-offset-8">
            العودة للرئيسية
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate={false} className="grid gap-8" aria-busy={isPending}>
      <p className="rounded-sm border border-cream-line bg-cream-2 px-4 py-3 text-on-cream-muted">
        إرسال هذا النموذج استفسار، وليس حجزاً مؤكداً. نتواصل معك لتأكيد الموعد والتفاصيل.
      </p>

      <ol className="flex gap-6 text-sm" aria-label="خطوات النموذج">
        <li aria-current={step === 1 ? "step" : undefined} className={step === 1 ? "font-semibold" : "text-on-cream-muted"}>
          ١. الأساسيات
        </li>
        <li aria-current={step === 2 ? "step" : undefined} className={step === 2 ? "font-semibold" : "text-on-cream-muted"}>
          ٢. تفاصيل إضافية
        </li>
      </ol>

      {state.status === "error" ? (
        <div role="alert" className="rounded-sm border border-danger/40 bg-danger/5 px-4 py-3 text-danger">
          {state.message}
        </div>
      ) : null}

      <fieldset ref={step1Ref} hidden={step !== 1} className="grid gap-6">
        <legend className="sr-only">الأساسيات</legend>
        <Field id="contact_name" label="الاسم" error={errors.contact_name}>
          <input id="contact_name" name="contact_name" required minLength={2} maxLength={80} autoComplete="name" className="field" {...aria("contact_name")} />
        </Field>
        <Field id="contact_phone" label="رقم الهاتف" error={errors.contact_phone} hint="نتواصل معك عليه (واتساب أو اتصال).">
          <input
            id="contact_phone"
            name="contact_phone"
            type="tel"
            dir="ltr"
            required
            inputMode="tel"
            autoComplete="tel"
            pattern="[0-9+\s\-]{7,25}"
            className="field text-end"
            {...aria("contact_phone")}
          />
        </Field>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="event_type" label="نوع المناسبة" error={errors.event_type}>
            <select id="event_type" name="event_type" required defaultValue="" className="field" {...aria("event_type")}>
              <option value="" disabled>
                اختر…
              </option>
              {EVENT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="event_date" label="تاريخ المناسبة" error={errors.event_date}>
            <input id="event_date" name="event_date" type="date" required className="field" {...aria("event_date")} />
          </Field>
        </div>
        <div>
          <button type="button" onClick={goNext} className="inline-flex min-h-12 items-center rounded-sm bg-gold px-8 font-medium text-ink hover:bg-gold-press">
            التالي
          </button>
        </div>
      </fieldset>

      <fieldset hidden={step !== 2} className="grid gap-6">
        <legend className="sr-only">تفاصيل إضافية (اختياري)</legend>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="city" label="المدينة / البلدة" optional error={errors.city}>
            <input id="city" name="city" maxLength={80} autoComplete="address-level2" className="field" />
          </Field>
          <Field id="venue" label="مكان المناسبة" optional error={errors.venue}>
            <input id="venue" name="venue" maxLength={120} className="field" />
          </Field>
          <Field id="guests" label="عدد الضيوف التقريبي" optional error={errors.guests}>
            <input id="guests" name="guests" type="number" min={1} max={5000} inputMode="numeric" className="field" {...aria("guests")} />
          </Field>
          <Field id="contact_email" label="البريد الإلكتروني" optional error={errors.contact_email}>
            <input id="contact_email" name="contact_email" type="email" dir="ltr" autoComplete="email" className="field text-end" {...aria("contact_email")} />
          </Field>
        </div>
        <fieldset className="grid gap-3">
          <legend className="mb-2 font-medium">
            الخدمات التي تهمك <span className="ms-2 text-sm font-normal text-on-cream-muted">(اختياري)</span>
          </legend>
          <div className="flex flex-wrap gap-3">
            {SERVICE_OPTIONS.map((s) => (
              <label key={s.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border border-cream-line bg-[#fffdf8] px-4 has-[:checked]:border-on-cream">
                <input type="checkbox" name="services" value={s.value} className="size-4 accent-[var(--color-on-cream)]" />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="message" label="شي بتحب نعرفه" optional error={errors.message}>
          <textarea id="message" name="message" rows={4} maxLength={1000} className="field" />
        </Field>

        {TURNSTILE_SITE_KEY ? (
          <>
            <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
            <div className="cf-turnstile" data-sitekey={TURNSTILE_SITE_KEY} data-language="ar" />
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-6">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex min-h-12 items-center rounded-sm bg-gold px-8 font-medium text-ink hover:bg-gold-press disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "جارِ الإرسال…" : "أرسل الطلب"}
          </button>
          <button type="button" onClick={() => setStep(1)} disabled={isPending} className="min-h-11 underline decoration-1 underline-offset-8">
            رجوع
          </button>
        </div>
      </fieldset>
    </form>
  );
}
