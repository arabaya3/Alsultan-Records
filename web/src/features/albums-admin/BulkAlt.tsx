"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { inputCls } from "@/features/admin/ui";
import { setPhotoAlts } from "./actions";

/**
 * Bulk alt-text editing for one album: every photo's «وصف الصورة» field registers here; one bar shows how many are
 * changed and saves them together («حفظ الأوصاف»). A partial failure marks only the failed fields (aria-invalid +
 * message linked with aria-describedby) and keeps what the admin typed; saved fields get the new value as baseline.
 * Leaving the page with unsaved descriptions asks first. Nothing is generated: the texts are exactly what was typed.
 */
type Ctx = {
  setValue: (id: string, value: string, baseline: string) => void;
  error: (id: string) => string | undefined;
  baseline: (id: string, initial: string) => string;
};
const BulkAltCtx = createContext<Ctx | null>(null);

export function BulkAltProvider({ albumId, children }: { albumId: string; children: ReactNode }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [baselines, setBaselines] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [initials, setInitials] = useState<Record<string, string>>({});

  const dirtyIds = useMemo(
    () => Object.keys(values).filter((id) => values[id] !== (baselines[id] ?? initials[id] ?? "")),
    [values, baselines, initials],
  );

  const setValue = useCallback((id: string, value: string, base: string) => {
    setInitials((i) => (id in i ? i : { ...i, [id]: base }));
    setValues((v) => ({ ...v, [id]: value }));
    setMsg(null);
  }, []);

  useEffect(() => {
    if (!dirtyIds.length) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyIds.length]);

  async function save() {
    if (!dirtyIds.length || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await setPhotoAlts(albumId, dirtyIds.map((id) => ({ id, alt: values[id] })));
      const nextErrors: Record<string, string> = {};
      const saved: Record<string, string> = {};
      for (const r of res.results) {
        if (r.ok) saved[r.id] = values[r.id];
        else nextErrors[r.id] = r.message ?? "تعذّر الحفظ.";
      }
      setBaselines((b) => ({ ...b, ...saved }));
      setErrors(nextErrors);
      setMsg({ ok: res.ok, text: res.message });
    } catch {
      setMsg({ ok: false, text: "تعذّر الاتصال بالخادم — لم يُحفظ شيء، والنصوص ما زالت في الحقول." });
    } finally {
      setBusy(false);
    }
  }

  const ctx = useMemo<Ctx>(
    () => ({
      setValue,
      error: (id) => errors[id],
      baseline: (id, init) => baselines[id] ?? init,
    }),
    [setValue, errors, baselines],
  );

  return (
    <BulkAltCtx.Provider value={ctx}>
      {children}
      <div
        data-testid="bulk-alt-bar"
        data-dirty={dirtyIds.length}
        className={`sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 mt-4 flex flex-wrap items-center gap-3 rounded-md border bg-ivory p-3 shadow-lg ${
          dirtyIds.length ? "border-gold" : "border-cream-line"
        }`}
      >
        <p className="text-sm" aria-live="polite">
          {dirtyIds.length ? `تغييرات غير محفوظة في ${dirtyIds.length} ${dirtyIds.length === 1 ? "وصف" : "أوصاف"}` : "لا توجد تغييرات غير محفوظة في الأوصاف."}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={!dirtyIds.length || busy}
          data-testid="bulk-alt-save"
          className="inline-flex min-h-11 items-center rounded-sm bg-gold px-4 text-sm font-medium text-ink hover:bg-gold-press disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "جارٍ الحفظ…" : "حفظ الأوصاف"}
        </button>
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} data-testid="bulk-alt-msg" data-ok={msg.ok ? "1" : "0"} className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </BulkAltCtx.Provider>
  );
}

/** One photo's alt field (visible label, error linked to the input). */
export function AltField({ photoId, initial, index }: { photoId: string; initial: string; index: number }) {
  const ctx = useContext(BulkAltCtx);
  const id = useId();
  const [value, setValue] = useState(initial);
  const error = ctx?.error(photoId);
  const dirty = value !== (ctx?.baseline(photoId, initial) ?? initial);
  return (
    <div className="mt-2 text-sm">
      <label htmlFor={id} className="mb-1 block font-medium">
        وصف الصورة {index} (نص بديل){dirty ? <span className="ms-2 text-xs text-gold-press">· غير محفوظ</span> : null}
      </label>
      <input
        id={id}
        value={value}
        maxLength={300}
        data-testid="photo-alt"
        data-photo-id={photoId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : `${id}-help`}
        onChange={(e) => {
          setValue(e.target.value);
          ctx?.setValue(photoId, e.target.value, initial);
        }}
        className={`${inputCls} w-full ${error ? "!border-danger" : ""}`}
      />
      {error ? (
        <p id={`${id}-err`} role="alert" data-testid="photo-alt-error" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : (
        <p id={`${id}-help`} className="mt-1 text-xs text-on-cream-muted">
          وصف قصير لما في الصورة لمن لا يراها. يُحفظ مع «حفظ الأوصاف».
        </p>
      )}
    </div>
  );
}
