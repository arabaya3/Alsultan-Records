"use client";

import { startTransition, useActionState, useRef, type FormEvent, type ReactNode } from "react";
import type { ActionResult } from "./result";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

const btnBase =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const KIND = {
  primary: "bg-gold text-ink hover:bg-gold-press",
  secondary: "bg-ink text-on-dark hover:bg-ink-2",
  ghost: "border border-cream-line bg-[#fffdf8] hover:border-on-cream-muted",
  danger: "border border-danger/50 text-danger hover:bg-danger/10",
} as const;

export type Confirm = { title: string; body?: string; confirmLabel?: string };

/**
 * Server-action form with inline result message and optional custom
 * confirmation dialog (never window.confirm).
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  kind = "secondary",
  confirm,
  className = "",
  resetOnSuccess = false,
  disabled = false,
  testId,
  inline = false,
  id,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel: string;
  kind?: keyof typeof KIND;
  confirm?: Confirm;
  className?: string;
  resetOnSuccess?: boolean;
  disabled?: boolean;
  testId?: string;
  inline?: boolean;
  id?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(async (prev, fd) => {
    const r = await action(prev, fd);
    if (r.ok && resetOnSuccess) formRef.current?.reset();
    return r;
  }, { ok: true, message: "" });

  // Submit through onSubmit (not <form action>) so React does not auto-reset the
  // form: on an error the user keeps what they typed.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <form
      ref={formRef}
      id={id}
      onSubmit={onSubmit}
      data-testid={testId}
      className={inline ? `inline-flex flex-wrap items-center gap-2 ${className}` : `space-y-3 ${className}`}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        {confirm ? (
          <button
            type="button"
            disabled={pending || disabled}
            className={`${btnBase} ${KIND[kind]}`}
            onClick={() => {
              if (formRef.current?.reportValidity()) dialogRef.current?.showModal();
            }}
          >
            {pending ? "جارٍ التنفيذ…" : submitLabel}
          </button>
        ) : (
          <button type="submit" disabled={pending || disabled} className={`${btnBase} ${KIND[kind]}`}>
            {pending ? "جارٍ التنفيذ…" : submitLabel}
          </button>
        )}
        {state.message ? (
          <p
            role={state.ok ? "status" : "alert"}
            data-testid="action-msg"
            data-ok={state.ok ? "1" : "0"}
            className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}
          >
            {state.message}
          </p>
        ) : null}
      </div>
      {confirm ? (
        <dialog
          ref={dialogRef}
          aria-labelledby="confirm-title"
          className="m-auto w-[min(92vw,28rem)] rounded-md border border-cream-line bg-cream p-0 text-on-cream backdrop:bg-ink/60"
        >
          <div className="p-5">
            <h2 id="confirm-title" className="text-lg font-semibold">
              {confirm.title}
            </h2>
            {confirm.body ? <p className="mt-2 text-sm text-on-cream-muted">{confirm.body}</p> : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" className={`${btnBase} ${KIND.ghost}`} onClick={() => dialogRef.current?.close()}>
                تراجع
              </button>
              <button
                type="button"
                data-testid="confirm-yes"
                className={`${btnBase} ${kind === "danger" ? "bg-danger text-white hover:opacity-90" : KIND.secondary}`}
                onClick={() => {
                  dialogRef.current?.close();
                  formRef.current?.requestSubmit();
                }}
              >
                {confirm.confirmLabel ?? "تأكيد"}
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </form>
  );
}
