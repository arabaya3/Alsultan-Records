"use client";

import { goToLogin } from "@/features/portal/client-nav";
import { useState } from "react";
import { getDownloadUrl, requestRevision } from "@/features/deliverables/actions";


/** Mints a fresh short-lived signed URL on every click, then starts the download. */
export function DownloadButton({ assetId, label = "تنزيل" }: { assetId: string; label?: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={state === "loading"}
        className="min-h-11 rounded-sm border border-on-cream/30 px-4 hover:border-gold disabled:opacity-60"
        onClick={async () => {
          setState("loading");
          const res = await getDownloadUrl(assetId).catch(() => null);
          if (res?.ok) {
            setState("idle");
            window.location.assign(res.data.url);
          } else {
            if (res?.code === "auth") return goToLogin();
            setState("error");
            setMsg(res?.error ?? "تعذّر تجهيز الرابط. حاول مرة أخرى.");
          }
        }}
      >
        {state === "loading" ? "جارِ التجهيز…" : state === "error" ? "إعادة المحاولة" : label}
      </button>
      {state === "error" ? (
        <span role="alert" className="text-sm text-danger">
          {msg}
        </span>
      ) : null}
    </span>
  );
}

export function RequestRevisionForm({ deliverableId }: { deliverableId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  if (state === "done") return <p role="status" className="text-success">تم إرسال طلب التعديل إلى الاستوديو.</p>;
  if (!open)
    return (
      <button type="button" className="min-h-11 rounded-sm border border-on-cream/30 px-4 hover:border-gold" onClick={() => setOpen(true)}>
        طلب تعديلات
      </button>
    );
  return (
    <form
      className="w-full max-w-xl"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("saving");
        const res = await requestRevision(deliverableId, note).catch(() => null);
        if (res?.ok) return setState("done");
        if (res?.code === "auth") return goToLogin();
        setState("error");
        setMsg(res?.error ?? "تعذّر الإرسال. حاول مرة أخرى.");
      }}
    >
      <label htmlFor={`rev-${deliverableId}`} className="mb-1 block text-sm">
        ما الذي تودّ تعديله؟
      </label>
      <textarea id={`rev-${deliverableId}`} className="field min-h-24" value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} required />
      {state === "error" ? (
        <p role="alert" className="mt-1 text-sm text-danger">
          {msg}
        </p>
      ) : null}
      <div className="mt-2 flex gap-3">
        <button type="submit" disabled={state === "saving"} className="min-h-11 rounded-sm bg-gold px-5 font-medium text-ink disabled:opacity-60">
          {state === "saving" ? "جارِ الإرسال…" : "إرسال الطلب"}
        </button>
        <button type="button" className="min-h-11 px-3 underline" onClick={() => setOpen(false)}>
          إلغاء
        </button>
      </div>
    </form>
  );
}
