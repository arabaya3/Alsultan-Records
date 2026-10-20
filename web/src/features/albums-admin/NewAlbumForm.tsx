"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { createAlbumDraft } from "./actions";
import { ALBUM_ACCEPT, ALBUM_IMAGE_MAX_BYTES, ALBUM_RAW_MAX_BYTES, fmtMb } from "./rules";
import { putHandoff } from "./upload-handoff";

/**
 * «ألبوم جديد»: details + photos on one form → «إنشاء ورفع». The album is created as a DRAFT (never published
 * automatically), then the editor opens and the chosen photos start uploading there right away — no second
 * picking, no other list. If creating fails, every field and the chosen photos stay as they were.
 */
export function NewAlbumForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drag, setDrag] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData(e.currentTarget);
      fd.delete("photos"); // files go straight to storage from the editor, never through this request
      const r = await createAlbumDraft(fd);
      if (!r.ok || !r.id) {
        setMsg({ ok: false, text: r.message ?? "تعذّر إنشاء الألبوم." });
        return;
      }
      if (files.length) putHandoff(r.id, files);
      setMsg({ ok: true, text: files.length ? "انعمل الألبوم — بلّش رفع الصور…" : "انعمل الألبوم." });
      router.push(`/admin/albums/${r.id}`);
    } catch {
      setMsg({ ok: false, text: "تعذّر الاتصال بالخادم — بياناتك والصور المختارة ما زالت هنا." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} data-testid="album-create" className="space-y-4">
      {children}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)]);
        }}
        className={`rounded-md border-2 border-dashed p-3 ${drag ? "border-gold bg-gold/10" : "border-cream-line"}`}
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">صور الألبوم (اختياري — بتقدر تضيف لاحقاً)</span>
          <input
            name="photos"
            type="file"
            multiple
            accept={ALBUM_ACCEPT}
            data-testid="album-create-photos"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="text-sm"
          />
        </label>
        <p className="mt-1 text-xs text-on-cream-muted">
          {files.length ? `${files.length} ملف مختار · ` : "اختر أو اسحب الصور هنا · "}
          الصور حتى {fmtMb(ALBUM_IMAGE_MAX_BYTES)} وملفات RAW حتى {fmtMb(ALBUM_RAW_MAX_BYTES)} للملف.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center rounded-sm bg-gold px-5 text-sm font-medium text-ink hover:bg-gold-press disabled:opacity-50">
          {busy ? "جارٍ الإنشاء…" : files.length ? `إنشاء ورفع (${files.length})` : "إنشاء الألبوم"}
        </button>
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} data-testid="action-msg" data-ok={msg.ok ? "1" : "0"} className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
