"use client";

import { startTransition, useActionState, type ReactNode } from "react";
import type { ActionResult } from "./result";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/**
 * On/off switch that saves at once (show / hide a menu link or a home section). A real switch for assistive tech
 * (role="switch", aria-checked) with the state written next to it («ظاهر» / «مخفي»). `fields` are the hidden inputs
 * the server action expects for the NEW state.
 */
export function ToggleAction({
  action,
  on,
  label,
  fields,
  onText = "ظاهر",
  offText = "مخفي",
  testId,
}: {
  action: Action;
  on: boolean;
  /** What is switched, for screen readers: «إظهار: العروض». */
  label: string;
  fields: ReactNode;
  onText?: string;
  offText?: string;
  testId?: string;
}) {
  const [state, run, pending] = useActionState<ActionResult, FormData>((prev, fd) => action(prev, fd), { ok: true, message: "" });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => run(fd));
      }}
      className="inline-flex items-center gap-2"
      data-testid={testId}
    >
      {fields}
      <span className={`text-sm ${on ? "text-on-cream" : "text-on-cream-muted"}`} aria-hidden="true">
        {on ? onText : offText}
      </span>
      <button
        type="submit"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={pending}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60 ${
          on ? "border-gold-press bg-gold" : "border-cream-line bg-cream-2"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 size-[1.375rem] rounded-full bg-white shadow transition-[inset-inline-start] ${on ? "start-0.5" : "start-[1.4rem]"}`}
        />
      </button>
      {!state.ok && state.message ? (
        <span role="alert" className="text-xs text-danger" data-testid="action-msg" data-ok="0">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
