"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  enrollMfa,
  requestPasswordReset,
  sendMagicLink,
  signInWithPassword,
  updatePassword,
  verifyMfa,
  type AuthState,
} from "@/features/auth/actions";

const idle: AuthState = { status: "idle" };
const submitCls =
  "inline-flex min-h-12 w-full items-center justify-center rounded-sm bg-gold px-8 font-medium text-ink hover:bg-gold-press disabled:opacity-60";

function Message({ state }: { state: AuthState }) {
  if (state.status === "error")
    return (
      <p role="alert" className="rounded-sm border border-danger/40 bg-danger/5 px-4 py-3 text-danger">
        {state.message}
      </p>
    );
  if (state.status === "sent")
    return (
      <p role="status" className="rounded-sm border border-success/40 bg-success/5 px-4 py-3 text-success">
        {state.message}
      </p>
    );
  return null;
}

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "magic" | "reset">("password");
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, idle);
  const [mlState, mlAction, mlPending] = useActionState(sendMagicLink, idle);
  const [rsState, rsAction, rsPending] = useActionState(requestPasswordReset, idle);

  if (mode === "magic")
    return (
      <form action={mlAction} className="grid gap-5" aria-busy={mlPending}>
        <input type="hidden" name="next" value={next} />
        <Field id="ml-email" name="email" label="البريد الإلكتروني" type="email" autoComplete="email" />
        <Message state={mlState} />
        <button className={submitCls} disabled={mlPending}>
          {mlPending ? "جارِ الإرسال…" : "أرسل لي رابط الدخول"}
        </button>
        <button type="button" className="min-h-11 underline" onClick={() => setMode("password")}>
          الدخول بكلمة المرور
        </button>
      </form>
    );

  if (mode === "reset")
    return (
      <form action={rsAction} className="grid gap-5" aria-busy={rsPending}>
        <p className="text-on-cream-muted">أدخل بريدك وسنرسل لك رابطاً لتعيين كلمة مرور جديدة.</p>
        <Field id="rs-email" name="email" label="البريد الإلكتروني" type="email" autoComplete="email" />
        <Message state={rsState} />
        <button className={submitCls} disabled={rsPending}>
          {rsPending ? "جارِ الإرسال…" : "أرسل رابط إعادة التعيين"}
        </button>
        <button type="button" className="min-h-11 underline" onClick={() => setMode("password")}>
          العودة لتسجيل الدخول
        </button>
      </form>
    );

  return (
    <form action={pwAction} className="grid gap-5" aria-busy={pwPending}>
      <input type="hidden" name="next" value={next} />
      <Field id="email" name="email" label="البريد الإلكتروني" type="email" autoComplete="email" defaultValue={pwState.email} />
      <Field id="password" name="password" label="كلمة المرور" type="password" autoComplete="current-password" />
      <Message state={pwState} />
      <button className={submitCls} disabled={pwPending}>
        {pwPending ? "جارِ الدخول…" : "تسجيل الدخول"}
      </button>
      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <button type="button" className="min-h-11 underline" onClick={() => setMode("reset")}>
          نسيت كلمة المرور؟
        </button>
        <button type="button" className="min-h-11 underline" onClick={() => setMode("magic")}>
          الدخول برابط عبر البريد
        </button>
      </div>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, idle);
  return (
    <form action={action} className="grid gap-5" aria-busy={pending}>
      <Field id="password" name="password" label="كلمة المرور الجديدة" type="password" autoComplete="new-password" />
      <Field id="confirm" name="confirm" label="تأكيد كلمة المرور" type="password" autoComplete="new-password" />
      <Message state={state} />
      <button className={submitCls} disabled={pending}>
        {pending ? "جارِ الحفظ…" : "حفظ كلمة المرور"}
      </button>
    </form>
  );
}

export function MfaForm({ next, hasFactor }: { next: string; hasFactor: boolean }) {
  const [state, action, pending] = useActionState(verifyMfa, idle);
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [enrollMsg, setEnrollMsg] = useState("");

  if (!hasFactor && !enroll)
    return (
      <div className="grid gap-4">
        <p>حسابك يتطلب التحقق بخطوتين. اربط تطبيق مصادقة (مثل Google Authenticator) للمتابعة.</p>
        {enrollMsg ? <p role="alert" className="text-danger">{enrollMsg}</p> : null}
        <button
          type="button"
          className={submitCls}
          onClick={async () => {
            const r = await enrollMfa().catch(() => null);
            if (r?.ok) setEnroll(r);
            else setEnrollMsg(r?.message ?? "تعذّر بدء الإعداد.");
          }}
        >
          إعداد تطبيق المصادقة
        </button>
      </div>
    );

  return (
    <form action={action} className="grid gap-5" aria-busy={pending}>
      <input type="hidden" name="next" value={next} />
      {enroll ? (
        <div className="grid justify-items-center gap-3 text-center">
          <p>امسح الرمز بتطبيق المصادقة ثم أدخل الرمز الظاهر فيه.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="رمز QR لربط تطبيق المصادقة" width={180} height={180} className="rounded-sm bg-white p-2" />
          <code dir="ltr" className="break-all text-xs">{enroll.secret}</code>
          <input type="hidden" name="factorId" value={enroll.factorId} />
        </div>
      ) : null}
      <Field id="code" name="code" label="رمز التحقق (٦ أرقام)" inputMode="numeric" autoComplete="one-time-code" dir="ltr" />
      <Message state={state} />
      <button className={submitCls} disabled={pending}>
        {pending ? "جارِ التحقق…" : "تحقّق"}
      </button>
      <Link href="/login" className="text-center text-sm underline">
        الدخول بحساب آخر
      </Link>
    </form>
  );
}

function Field({
  id,
  label,
  ...rest
}: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input id={id} required className="field" {...rest} />
    </div>
  );
}
