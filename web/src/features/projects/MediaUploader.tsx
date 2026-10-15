"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { ACCEPT, checkFile, MAX_FILES_PER_BATCH } from "./media-rules";
import { finalizeUpload, markUploadFailed, prepareUploads, refreshMedia } from "./media-actions";

type Row = { name: string; size: number; state: "waiting" | "uploading" | "processing" | "done" | "partial" | "failed"; message: string };

const STATE_LABEL: Record<Row["state"], string> = {
  waiting: "بالانتظار",
  uploading: "يُرفع…",
  processing: "تجهيز المعاينات…",
  done: "تم",
  partial: "تم جزئياً",
  failed: "فشل",
};

/** Browser → storage direct upload via signed upload URLs (large files never pass through the app server). */
export function MediaUploader({ eventId }: { eventId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("");

  const patch = (i: number, p: Partial<Row>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...p } : row)));

  async function start() {
    const files = Array.from(inputRef.current?.files ?? []);
    if (!files.length) return;
    if (files.length > MAX_FILES_PER_BATCH) {
      setSummary(`الحد ${MAX_FILES_PER_BATCH} ملفاً في كل دفعة.`);
      return;
    }
    setBusy(true);
    setSummary("");
    const initial: Row[] = files.map((f) => {
      const problem = checkFile(f);
      return { name: f.name, size: f.size, state: problem ? "failed" : "waiting", message: problem ?? "" };
    });
    setRows(initial);
    const valid = files.map((f, i) => ({ f, i })).filter(({ i }) => initial[i].state === "waiting");
    let prepared: Awaited<ReturnType<typeof prepareUploads>>;
    try {
      prepared = await prepareUploads(
        eventId,
        valid.map(({ f }) => ({ name: f.name, type: f.type, size: f.size })),
      );
    } catch {
      prepared = { ok: false, message: "تعذّر الاتصال بالخادم.", items: [] };
    }
    if (!prepared.items.length) {
      valid.forEach(({ i }) => patch(i, { state: "failed", message: prepared.message ?? "تعذّر التجهيز." }));
      setSummary(`فشل ${files.length} من ${files.length}.`);
      setBusy(false);
      return;
    }
    const sb = createClient();
    let done = 0;
    let partial = 0;
    let failed = initial.filter((r) => r.state === "failed").length;
    // Sequential: predictable memory/bandwidth for large files.
    for (let k = 0; k < prepared.items.length; k++) {
      const item = prepared.items[k];
      const { f, i } = valid[k];
      if (!item.ok) {
        patch(i, { state: "failed", message: item.message });
        failed++;
        continue;
      }
      patch(i, { state: "uploading", message: "" });
      const up = await sb.storage.from("private-media").uploadToSignedUrl(item.path, item.token, f, { contentType: f.type });
      if (up.error) {
        await markUploadFailed(item.assetId);
        patch(i, { state: "failed", message: "انقطع الرفع أو رُفض الملف." });
        failed++;
        continue;
      }
      patch(i, { state: "processing" });
      try {
        const r = await finalizeUpload(item.assetId);
        if (!r.ok) {
          patch(i, { state: "failed", message: r.message });
          failed++;
        } else if (f.type.startsWith("image/") && !r.variants) {
          patch(i, { state: "partial", message: r.message });
          partial++;
        } else {
          patch(i, { state: "done", message: r.message });
          done++;
        }
      } catch {
        patch(i, { state: "failed", message: "رُفع الملف لكن تعذّر إكماله. أعد المحاولة من القائمة." });
        failed++;
      }
    }
    setSummary(`اكتمل ${done}${partial ? `، جزئي ${partial}` : ""}${failed ? `، فشل ${failed}` : ""} من ${files.length}.`);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    await refreshMedia();
  }

  return (
    <div className="space-y-3" data-testid="uploader">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="sr-only">اختر الملفات</span>
          <input ref={inputRef} type="file" multiple accept={ACCEPT} disabled={busy} data-testid="upload-input" className="text-sm" />
        </label>
        <button
          type="button"
          onClick={start}
          disabled={busy}
          data-testid="upload-start"
          className="inline-flex min-h-10 items-center rounded-sm bg-gold px-4 text-sm font-medium text-ink hover:bg-gold-press disabled:opacity-50"
        >
          {busy ? "جارٍ الرفع…" : "رفع"}
        </button>
      </div>
      <p className="text-xs text-on-cream-muted">صور حتى 50MB، فيديو حتى 2GB، PDF/ZIP. يُرفع كل ملف مباشرة إلى التخزين الخاص.</p>
      {rows.length ? (
        <ul className="divide-y divide-cream-line rounded-md border border-cream-line text-sm" aria-live="polite">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid="upload-row" data-state={r.state}>
              <span className="min-w-0 truncate" dir="ltr">{r.name}</span>
              <span className={r.state === "failed" ? "text-danger" : r.state === "partial" ? "text-on-cream" : r.state === "done" ? "text-success" : "text-on-cream-muted"}>
                {STATE_LABEL[r.state]}{r.message ? ` · ${r.message}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {summary ? <p role="status" data-testid="upload-summary" className="text-sm font-medium">{summary}</p> : null}
    </div>
  );
}
