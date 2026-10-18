"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ActionResult } from "@/features/admin/result";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
export type Intent = { intent: string; label: string; kind?: "primary" | "secondary" | "ghost" | "danger" };

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const KIND = {
  primary: "bg-gold text-ink hover:bg-gold-press",
  secondary: "bg-ink text-on-dark hover:bg-ink-2",
  ghost: "border border-cream-line bg-[#fffdf8] hover:border-on-cream-muted",
  danger: "border border-danger/50 text-danger hover:bg-danger/10",
} as const;

// One module-level dirty registry so the in-app link guard covers every CmsForm on the page.
const dirtyForms = new Set<string>();
let guardInstalled = false;
function installGuard() {
  if (guardInstalled || typeof window === "undefined") return;
  guardInstalled = true;
  window.addEventListener("beforeunload", (e) => {
    if (dirtyForms.size) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  // In-app navigation (Next <Link> = <a>): ask before leaving with unsaved edits.
  document.addEventListener(
    "click",
    (e) => {
      if (!dirtyForms.size) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const dlg = document.getElementById("cms-unsaved-dialog") as HTMLDialogElement | null;
      if (!dlg) return;
      e.preventDefault();
      e.stopPropagation();
      dlg.dataset.href = a.href;
      dlg.showModal();
    },
    true,
  );
}

/** Dialog shown when leaving with unsaved changes. Rendered once per CmsForm (same id; the first wins). */
function UnsavedDialog() {
  return (
    <dialog
      id="cms-unsaved-dialog"
      aria-labelledby="cms-unsaved-title"
      className="m-auto w-[min(92vw,26rem)] rounded-md border border-cream-line bg-cream p-0 text-on-cream backdrop:bg-ink/60"
    >
      <div className="p-5">
        <h2 id="cms-unsaved-title" className="text-lg font-semibold">
          لديك تغييرات غير محفوظة
        </h2>
        <p className="mt-2 text-sm text-on-cream-muted">إذا غادرت الآن ستضيع التعديلات التي لم تحفظها.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={`${base} ${KIND.ghost}`}
            onClick={(e) => (e.currentTarget.closest("dialog") as HTMLDialogElement).close()}
          >
            البقاء والحفظ
          </button>
          <button
            type="button"
            data-testid="leave-unsaved"
            className={`${base} ${KIND.danger}`}
            onClick={(e) => {
              const dlg = e.currentTarget.closest("dialog") as HTMLDialogElement;
              const href = dlg.dataset.href;
              dirtyForms.clear();
              dlg.close();
              if (href) window.location.assign(href);
            }}
          >
            المغادرة بدون حفظ
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Content form: several submit intents (draft / preview / publish / hide), inline result message,
 * unsaved-changes warning (beforeunload + in-app links). Keeps typed values on error.
 */
export function CmsForm({
  action,
  children,
  intents = [{ intent: "save", label: "حفظ", kind: "primary" }],
  testId,
  className = "",
  guardChanges = true,
  resetOnSuccess = false,
}: {
  action: Action;
  children: ReactNode;
  intents?: Intent[];
  testId?: string;
  className?: string;
  guardChanges?: boolean;
  resetOnSuccess?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [key] = useState(() => Math.random().toString(36).slice(2));
  const [dirty, setDirty] = useState(false);
  const [state, run, pending] = useActionState<ActionResult, FormData>(
    async (prev, fd) => {
      const r = await action(prev, fd);
      if (r.ok) {
        dirtyForms.delete(key);
        setDirty(false);
        if (resetOnSuccess) ref.current?.reset();
      }
      return r;
    },
    { ok: true, message: "" },
  );

  useEffect(() => {
    if (guardChanges) installGuard();
    return () => {
      dirtyForms.delete(key);
    };
  }, [guardChanges, key]);

  function markDirty() {
    if (!guardChanges) return;
    dirtyForms.add(key);
    setDirty(true);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    // A redirect (create/preview) navigates away: do not warn.
    dirtyForms.delete(key);
    startTransition(() => run(fd));
  }

  return (
    <form ref={ref} onSubmit={onSubmit} onInput={markDirty} onChange={markDirty} data-testid={testId} data-dirty={dirty ? "1" : "0"} className={`space-y-4 ${className}`}>
      {children}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-cream-line bg-[#fffdf8]/95 px-4 py-3">
        {intents.map((i) => (
          <button key={i.intent} type="submit" name="intent" value={i.intent} disabled={pending} className={`${base} ${KIND[i.kind ?? "secondary"]}`}>
            {pending ? "جارٍ الحفظ…" : i.label}
          </button>
        ))}
        {dirty && !pending ? <span className="text-xs text-on-cream-muted">تغييرات غير محفوظة</span> : null}
        {state.message ? (
          <p role={state.ok ? "status" : "alert"} data-testid="action-msg" data-ok={state.ok ? "1" : "0"} className={`basis-full text-sm ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </p>
        ) : null}
      </div>
      {guardChanges ? <UnsavedDialog /> : null}
    </form>
  );
}
