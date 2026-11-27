"use client";

import { startTransition, useActionState, useId, useRef, type FormEvent, type ReactNode } from "react";
import type { ActionResult } from "./result";
import { ModalCancel } from "./Modal";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

const btnBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
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
  variant = "button",
  icon,
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
  /** "menu": a full-width row inside a RowMenu (icon + label), its result message under it. */
  variant?: "button" | "menu";
  icon?: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(async (prev, fd) => {
    const r = await action(prev, fd);
    if (r.ok && resetOnSuccess) formRef.current?.reset();
    // A dialog around this form clears its «unsaved» flag (Modal).
    if (r.ok) formRef.current?.dispatchEvent(new CustomEvent("admin-saved", { bubbles: true }));
    return r;
  }, { ok: true, message: "" });

  // Submit through onSubmit (not <form action>) so React does not auto-reset the
  // form: on an error the user keeps what they typed.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  const menu = variant === "menu";
  const btnCls = menu
    ? `flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start disabled:opacity-50 ${kind === "danger" ? "text-danger hover:bg-danger/10" : "hover:bg-cream-2 focus-visible:bg-cream-2"}`
    : `${btnBase} ${KIND[kind]}`;
  const label = (
    <>
      {menu && icon ? <span aria-hidden="true" className={kind === "danger" ? "" : "text-on-cream-muted"}>{icon}</span> : null}
      <span className={menu ? "flex-1" : undefined}>{pending ? "جارٍ التنفيذ…" : submitLabel}</span>
    </>
  );
  return (
    <form
      ref={formRef}
      id={id}
      onSubmit={onSubmit}
      data-testid={testId}
      className={menu ? `block ${className}` : inline ? `inline-flex flex-wrap items-center gap-2 ${className}` : `space-y-3 ${className}`}
    >
      {children}
      <div className={menu ? "block" : "flex flex-wrap items-center gap-3"}>
        {confirm ? (
          <button
            type="button"
            disabled={pending || disabled}
            className={btnCls}
            onClick={() => {
              if (formRef.current?.reportValidity()) dialogRef.current?.showModal();
            }}
          >
            {label}
          </button>
        ) : (
          <button type="submit" disabled={pending || disabled} className={btnCls}>
            {label}
          </button>
        )}
        {menu ? null : <ModalCancel />}
        {state.message ? (
          <p
            role={state.ok ? "status" : "alert"}
            data-testid="action-msg"
            data-ok={state.ok ? "1" : "0"}
            className={`text-sm ${menu ? "px-3 pb-1 text-xs" : ""} ${state.ok ? "text-success" : "text-danger"}`}
          >
            {state.message}
          </p>
        ) : null}
      </div>
      {confirm ? (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          aria-describedby={confirm.body ? bodyId : undefined}
          className="m-auto w-[min(92vw,28rem)] rounded-md border border-cream-line bg-cream p-0 text-on-cream backdrop:bg-ink/60"
        >
          <div className="p-5">
            <h2 id={titleId} className="text-lg font-semibold">
              {confirm.title}
            </h2>
            {confirm.body ? <p id={bodyId} className="mt-2 text-sm text-on-cream-muted">{confirm.body}</p> : null}
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
