"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { ALBUM_ACCEPT, ALBUM_BUCKET, ALBUM_MAX_FILES_PER_BATCH, checkAlbumFile } from "./rules";
import { finalizeAlbumPhoto, markAlbumUploadFailed, prepareAlbumUploads, refreshAlbum } from "./actions";

type Row = { name: string; state: "waiting" | "uploading" | "processing" | "done" | "partial" | "failed"; message: string };

const STATE_LABEL: Record<Row["state"], string> = {
  waiting: "بالانتظار",
  uploading: "يُرفع…",
  processing: "تجهيز المعاينات…",
  done: "تم",
  partial: "تم جزئياً",
  failed: "فشل",
};

/** Bulk photo upload: browser → private `album-media` via signed upload URLs; server makes WebP variants. */
export function AlbumUploader({ albumId }: { albumId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("");
  const patch = (i: number, p: Partial<Row>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...p } : row)));

  async function start() {
    const files = Array.from(inputRef.current?.files ?? []);
    if (!files.length) {
      setSummary("اختر صوراً أولاً.");
      return;
    }
    if (files.length > ALBUM_MAX_FILES_PER_BATCH) {
      setSummary(`الحد ${ALBUM_MAX_FILES_PER_BATCH} صورة في كل دفعة.`);
      return;
    }
    setBusy(true);
    setSummary("");
    const initial: Row[] = files.map((f) => {
      const problem = checkAlbumFile(f);
      return { name: f.name, state: problem ? "failed" : "waiting", message: problem ?? "" };
    });
    setRows(initial);
    const valid = files.map((f, i) => ({ f, i })).filter(({ i }) => initial[i].state === "waiting");
    let failed = files.length - valid.length;
    let done = 0;
    let partial = 0;
    if (valid.length) {
      let prepared: Awaited<ReturnType<typeof prepareAlbumUploads>>;
      try {
        prepared = await prepareAlbumUploads(albumId, valid.map(({ f }) => ({ name: f.name, type: f.type, size: f.size })));
      } catch {
        prepared = { ok: false, message: "تعذّر الاتصال بالخادم.", items: [] };
      }
      if (!prepared.items.length) {
        valid.forEach(({ i }) => patch(i, { state: "failed", message: prepared.message ?? "تعذّر التجهيز." }));
        failed += valid.length;
      } else {
        const sb = createClient();
        for (let k = 0; k < prepared.items.length; k++) {
          const item = prepared.items[k];
          const { f, i } = valid[k];
          if (!item.ok) {
            patch(i, { state: "failed", message: item.message });
            failed++;
            continue;
          }
          patch(i, { state: "uploading", message: "" });
          const up = await sb.storage.from(ALBUM_BUCKET).uploadToSignedUrl(item.path, item.token, f, { contentType: f.type });
          if (up.error) {
            await markAlbumUploadFailed(item.photoId);
            patch(i, { state: "failed", message: "انقطع الرفع أو رُفض الملف." });
            failed++;
            continue;
          }
          patch(i, { state: "processing" });
          try {
            const r = await finalizeAlbumPhoto(item.photoId);
            if (!r.ok) {
              patch(i, { state: "failed", message: r.message });
              failed++;
            } else if (!r.variants) {
              patch(i, { state: "partial", message: r.message });
              partial++;
            } else {
              patch(i, { state: "done", message: r.message });
              done++;
            }
          } catch {
            patch(i, { state: "failed", message: "رُفع الملف لكن تعذّر إكماله." });
            failed++;
          }
        }
      }
    }
    setSummary(`اكتمل ${done}${partial ? `، جزئي ${partial}` : ""}${failed ? `، فشل ${failed}` : ""} من ${files.length}.`);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    await refreshAlbum();
  }

  return (
    <div className="space-y-3" data-testid="album-uploader">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">اختر الصور</span>
          <input ref={inputRef} type="file" multiple accept={ALBUM_ACCEPT} disabled={busy} data-testid="album-upload-input" className="text-sm" />
        </label>
        <button
          type="button"
          onClick={start}
          disabled={busy}
          data-testid="album-upload-start"
          className="inline-flex min-h-10 items-center rounded-sm bg-gold px-4 text-sm font-medium text-ink hover:bg-gold-press disabled:opacity-50"
        >
          {busy ? "جارٍ الرفع…" : "رفع الصور"}
        </button>
      </div>
      <p className="text-xs text-on-cream-muted">
        JPEG أو PNG أو WebP أو AVIF، حتى 25MB للصورة و{ALBUM_MAX_FILES_PER_BATCH} صورة في الدفعة. يُحفظ الأصل كما هو (لا قصّ ولا إزالة للعلامة المائية)، وتُنشأ نسختا عرض مصغّرتان.
      </p>
      {rows.length ? (
        <ul className="divide-y divide-cream-line rounded-md border border-cream-line text-sm" aria-live="polite">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid="album-upload-row" data-state={r.state}>
              <span className="min-w-0 truncate" dir="ltr">
                {r.name}
              </span>
              <span className={r.state === "failed" ? "text-danger" : r.state === "done" ? "text-success" : "text-on-cream-muted"}>
                {STATE_LABEL[r.state]}
                {r.message ? ` · ${r.message}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {summary ? (
        <p role="status" data-testid="album-upload-summary" className="text-sm font-medium">
          {summary}
        </p>
      ) : null}
    </div>
  );
}
