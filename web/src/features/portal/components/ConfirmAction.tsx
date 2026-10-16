"use client";

import { goToLogin } from "@/features/portal/client-nav";
import { useRef, useState } from "react";
import type { ActionResult } from "@/features/portal/session";

/** Two-step confirm button for irreversible customer actions (accept quote, approve contract). */
export function ConfirmAction({
  label,
  confirmText,
  doneText,
  run,
}: {
  label: string;
  confirmText: string;
  doneText: string;
  run: () => Promise<ActionResult>;
}) {
  const [step, setStep] = useState<"idle" | "confirm" | "saving" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  // The pressed button is replaced by the next step, so move focus to its replacement.
  const focusNext = useRef(false);
  const focusOnMount = (el: HTMLElement | null) => {
    if (el && focusNext.current) {
      focusNext.current = false;
      el.focus();
    }
  };
  if (step === "done")
    return (
      <p role="status" tabIndex={-1} ref={focusOnMount} className="text-success">
        {doneText}
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-3">
      {step === "confirm" || step === "saving" ? (
        <>
          <p>{confirmText}</p>
          <button
            type="button"
            disabled={step === "saving"}
            ref={focusOnMount}
            className="min-h-11 rounded-sm bg-gold px-6 font-medium text-ink hover:bg-gold-press disabled:opacity-60"
            onClick={async () => {
              setStep("saving");
              const res = await run().catch(() => null);
              focusNext.current = true; // the disabled button lost focus while saving
              if (res?.ok) return setStep("done");
              if (res && !res.ok && res.code === "auth")
                return goToLogin();
              setMsg(res && !res.ok ? res.error : "تعذّر التنفيذ الآن. حاول مرة أخرى.");
              setStep("error");
            }}
          >
            {step === "saving" ? "جارِ التنفيذ…" : "تأكيد"}
          </button>
          <button type="button" className="min-h-11 px-3 underline" onClick={() => {
              focusNext.current = true;
              setStep("idle");
            }}>
            تراجع
          </button>
        </>
      ) : (
        <button
          type="button"
          className="min-h-11 rounded-sm bg-gold px-6 font-medium text-ink hover:bg-gold-press"
          ref={focusOnMount}
          onClick={() => {
            focusNext.current = true;
            setStep("confirm");
          }}
        >
          {label}
        </button>
      )}
      {step === "error" ? (
        <p role="alert" className="w-full text-sm text-danger">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
