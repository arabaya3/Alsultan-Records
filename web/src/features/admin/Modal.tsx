"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const noop = () => () => {};

/**
 * Centred dialog for add / edit forms (native <dialog>: top layer, Esc, focus kept inside, focus returns to the
 * opener). The form inside keeps its own submit button; the dialog adds the close «×» and a «إلغاء» (ModalCancel).
 *
 * Unsaved changes: any typing inside marks the dialog dirty; closing it then asks first («إغلاق دون حفظ؟») and, if
 * confirmed, resets the forms to what was loaded. A successful save (the admin forms dispatch `admin-saved`) clears
 * the flag; `closeOnSave` also closes the dialog.
 */
type Ctx = { close: () => void };
const ModalCtx = createContext<Ctx | null>(null);

export function useModal() {
  return useContext(ModalCtx);
}

export function Modal({
  title,
  trigger,
  triggerClassName,
  children,
  size = "md",
  testId,
  closeOnSave = false,
  defaultOpen = false,
}: {
  title: string;
  /** The opener's content (text, icon…); rendered inside a <button>. */
  trigger: ReactNode;
  triggerClassName?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  testId?: string;
  closeOnSave?: boolean;
  defaultOpen?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  // The dialog is rendered at the end of <body>: a Modal may sit inside another form (e.g. the logo dialog next to the
  // identity form) without nesting forms. Its React events stop at the dialog so they never reach that outer form.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  const open = useCallback(() => {
    setAsking(false);
    ref.current?.showModal();
  }, []);
  const shut = useCallback(() => {
    setAsking(false);
    setDirty(false);
    ref.current?.close();
  }, []);
  const discard = useCallback(() => {
    ref.current?.querySelectorAll("form").forEach((f) => f.reset());
    shut();
  }, [shut]);
  const close = useCallback(() => {
    if (dirty) setAsking(true);
    else shut();
  }, [dirty, shut]);

  useEffect(() => {
    if (defaultOpen && mounted) ref.current?.showModal();
  }, [defaultOpen, mounted]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      // Esc: same rule as the close button.
      e.preventDefault();
      close();
    };
    const onSaved = () => {
      setDirty(false);
      setAsking(false);
      if (closeOnSave) d.close();
    };
    d.addEventListener("cancel", onCancel);
    d.addEventListener("admin-saved", onSaved);
    return () => {
      d.removeEventListener("cancel", onCancel);
      d.removeEventListener("admin-saved", onSaved);
    };
  }, [close, closeOnSave]);

  const width =
    size === "sm"
      ? "w-[min(94vw,32rem)]"
      : size === "lg"
        ? "w-[min(96vw,60rem)]"
        : "w-[min(94vw,44rem)]";

  return (
    <ModalCtx.Provider value={{ close }}>
      <button
        type="button"
        onClick={open}
        className={triggerClassName}
        aria-haspopup="dialog"
        data-testid={testId ? `${testId}-open` : undefined}
      >
        {trigger}
      </button>
      {mounted
        ? createPortal(
            <dialog
              ref={ref}
              aria-labelledby={titleId}
              data-testid={testId}
              onInput={(e) => {
                e.stopPropagation();
                setDirty(true);
              }}
              onChange={(e) => {
                e.stopPropagation();
                setDirty(true);
              }}
              onSubmit={(e) => e.stopPropagation()}
              className={`m-auto ${width} max-h-[92dvh] overflow-hidden rounded-2xl border border-cream-line bg-cream p-0 text-on-cream shadow-[0_30px_80px_-30px_rgb(10_15_30/0.55)] backdrop:bg-navy/60`}
            >
              <div className="flex max-h-[92dvh] flex-col">
                <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
                  <div>
                    <h2
                      id={titleId}
                      className="font-display text-xl font-bold md:text-2xl"
                    >
                      {title}
                    </h2>
                    <span
                      aria-hidden="true"
                      className="mt-2 block h-0.5 w-12 rounded-full bg-gold"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="إغلاق"
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-on-cream-muted hover:bg-cream-2 hover:text-on-cream"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      width="22"
                      height="22"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
                {asking ? (
                  <div
                    role="alertdialog"
                    aria-live="assertive"
                    className="mx-6 mb-3 flex flex-wrap items-center gap-3 rounded-md border border-gold/60 bg-gold/15 px-4 py-3 text-sm"
                  >
                    <span className="flex-1 font-medium">
                      لديك تغييرات غير محفوظة. إغلاق دون حفظ؟
                    </span>
                    <button
                      type="button"
                      onClick={discard}
                      className="min-h-10 rounded-sm bg-danger px-3 text-white"
                      data-testid="modal-discard"
                    >
                      إغلاق دون حفظ
                    </button>
                    <button
                      type="button"
                      onClick={() => setAsking(false)}
                      className="min-h-10 rounded-sm border border-cream-line bg-[#fffdf8] px-3"
                    >
                      متابعة التعديل
                    </button>
                  </div>
                ) : null}
                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                  {children}
                </div>
              </div>
            </dialog>,
            document.body,
          )
        : null}
    </ModalCtx.Provider>
  );
}

/** «إلغاء» next to a form's submit button inside a Modal (same rule as «×»). Renders nothing outside a Modal. */
export function ModalCancel({ label = "إلغاء" }: { label?: string }) {
  const m = useModal();
  if (!m) return null;
  return (
    <button
      type="button"
      onClick={m.close}
      className="inline-flex min-h-11 items-center justify-center rounded-sm border border-cream-line bg-[#fffdf8] px-5 text-sm font-medium hover:border-on-cream-muted"
    >
      {label}
    </button>
  );
}
