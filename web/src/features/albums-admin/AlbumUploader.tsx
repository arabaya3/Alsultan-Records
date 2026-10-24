"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getUnfinishedPhotos } from "./actions";
import { ALBUM_ACCEPT, ALBUM_IMAGE_MAX_BYTES, ALBUM_MAX_FILES_PER_BATCH, ALBUM_RAW_MAX_BYTES, FORMATS, FORMAT_IDS, fmtMb } from "./rules";
import { AlbumUploadQueue, type ItemState, type UploadItem } from "./upload-engine";
import { FilePicker } from "./FilePicker";
import { takeHandoff } from "./upload-handoff";

const LABEL: Record<ItemState, string> = {
  waiting: "في الانتظار",
  checking: "في الانتظار · فحص الملف",
  uploading: "جارٍ الرفع",
  processing: "جارٍ التجهيز",
  ready: "جاهز",
  failed: "فشل",
  skipped: "تم التخطي",
  canceled: "أُلغي",
};
const TONE: Partial<Record<ItemState, string>> = { failed: "text-danger", ready: "text-success" };
const IMAGE_FORMATS = FORMAT_IDS.filter((f) => FORMATS[f].kind === "image").map((f) => FORMATS[f].label).join("، ");
const RAW_FORMATS = FORMAT_IDS.filter((f) => FORMATS[f].kind === "raw").map((f) => FORMATS[f].label.split(" ").pop()).join("، ");
const mb = (b: number) => (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0);

/**
 * Album photo uploader (admin): pick or drop many photos; they upload straight to private storage, a few at a
 * time, resumable; the server prepares the web copies in the background and the grid fills in as they get ready.
 * Files handed over by «ألبوم جديد → إنشاء ورفع» start automatically.
 */
export function AlbumUploader({ albumId }: { albumId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);
  const [picked, setPicked] = useState<File[]>([]);
  // One queue per mounted editor (the album id is part of the route, so it never changes here).
  const [queue] = useState(() => new AlbumUploadQueue(albumId, setItems, () => router.refresh()));

  useEffect(() => {
    queue.attach(); // after a StrictMode/dev re-mount the same queue continues
    const handed = takeHandoff(albumId);
    if (handed.length) queue.add(handed);
    getUnfinishedPhotos(albumId)
      .then((list) => queue.addPrevious(list))
      .catch(() => undefined);
    return () => queue.dispose();
  }, [albumId, queue]);

  const busy = items.some((i) => i.state === "waiting" || i.state === "checking" || i.state === "uploading");
  // Leaving mid-upload stops the transfer (it can be resumed by choosing the same files again).
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  const settled = items.length > 0 && items.every((i) => ["ready", "failed", "skipped", "canceled"].includes(i.state));
  useEffect(() => {
    if (settled) router.refresh();
  }, [settled, router]);

  function enqueue(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return setNote("اختر صوراً أولاً.");
    if (files.length > ALBUM_MAX_FILES_PER_BATCH) return setNote(`الحد ${ALBUM_MAX_FILES_PER_BATCH} ملفاً في كل اختيار.`);
    setNote("");
    queue.add(files);
    if (inputRef.current) inputRef.current.value = "";
    setPicked([]);
  }

  const live = items.filter((i) => i.state !== "canceled" && i.state !== "skipped" && i.size > 0);
  const total = live.reduce((a, i) => a + i.size, 0);
  const sent = live.reduce((a, i) => a + (["processing", "ready"].includes(i.state) ? i.size : i.sent), 0);
  const n = (s: ItemState) => items.filter((i) => i.state === s).length;
  const counts = items.length
    ? `جاهز ${n("ready")} · جارٍ الرفع ${n("uploading") + n("checking")} · في الانتظار ${n("waiting")} · جارٍ التجهيز ${n("processing")} · فشل ${n("failed")} · تم التخطي ${n("skipped")}`
    : "";

  return (
    <div className="space-y-3" data-testid="album-uploader">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          enqueue(e.dataTransfer.files);
        }}
        data-testid="album-dropzone"
        className={`rounded-md border-2 border-dashed p-4 transition-colors ${drag ? "border-gold bg-gold/10" : "border-cream-line"}`}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="text-sm">
            <span className="mb-1 block font-medium">اختر الصور أو اسحبها هنا</span>
            <FilePicker
              files={picked}
              inputProps={{ ref: inputRef, multiple: true, accept: ALBUM_ACCEPT, "data-testid": "album-upload-input", onChange: (e) => setPicked(Array.from(e.currentTarget.files ?? [])) }}
            />
          </div>
          <button
            type="button"
            onClick={() => enqueue(inputRef.current?.files ?? null)}
            data-testid="album-upload-start"
            className="inline-flex min-h-11 items-center rounded-sm bg-gold px-4 text-sm font-medium text-ink hover:bg-gold-press"
          >
            رفع الصور
          </button>
          {busy ? (
            <button type="button" onClick={() => queue.cancelAll()} data-testid="album-upload-cancel-all" className="inline-flex min-h-11 items-center rounded-sm border border-cream-line px-3 text-sm hover:border-danger">
              إلغاء الكل
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-on-cream-muted" data-testid="album-upload-limits">
          الصور ({IMAGE_FORMATS}) حتى {fmtMb(ALBUM_IMAGE_MAX_BYTES)} للملف · ملفات RAW ({RAW_FORMATS}) حتى {fmtMb(ALBUM_RAW_MAX_BYTES)} للملف. HEIC غير مدعوم
          حالياً. يُحفظ الأصل كما هو بلا أي تعديل، وتُجهَّز نسخ العرض على الخادم — بتقدر تسكّر الصفحة بعد ما يخلص الرفع.
        </p>
      </div>

      {note ? <p className="text-sm text-danger">{note}</p> : null}

      {total > 0 ? (
        <div className="space-y-1" data-testid="album-upload-total">
          <progress max={total} value={sent} className="h-2 w-full" aria-label="التقدّم الإجمالي للرفع" />
          <p className="text-xs text-on-cream-muted" dir="rtl">
            {mb(sent)} من {mb(total)} MB
          </p>
        </div>
      ) : null}

      {items.length ? (
        <ul className="divide-y divide-cream-line rounded-md border border-cream-line text-sm" aria-live="polite">
          {items.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid="album-upload-row" data-state={r.state} data-photo-id={r.photoId}>
              <span className="min-w-0 truncate" dir="auto" data-file-name={r.name}>
                {r.name}
                {r.size ? <span className="ms-2 text-xs text-on-cream-muted">{mb(r.size)} MB</span> : null}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {r.state === "uploading" ? (
                  <progress max={r.size || 1} value={r.sent} className="h-2 w-28" aria-label={`تقدّم رفع ${r.name}`} />
                ) : null}
                <span className={TONE[r.state] ?? "text-on-cream-muted"}>
                  {LABEL[r.state]}
                  {r.state === "uploading" && r.size ? ` ${Math.floor((r.sent / r.size) * 100)}%` : ""}
                  {r.message ? ` · ${r.message}` : ""}
                </span>
                {r.warning ? (
                  <span className="text-xs text-gold-press" data-testid="album-upload-warning">
                    {r.warning}
                  </span>
                ) : null}
                {r.state === "failed" && (r.file || r.failedAt === "processing") ? (
                  <button type="button" onClick={() => void queue.retry(r.key)} data-testid="album-upload-retry" className="min-h-9 rounded-sm border border-cream-line px-2 text-xs hover:border-on-cream-muted">
                    إعادة المحاولة
                  </button>
                ) : null}
                {["waiting", "checking", "uploading"].includes(r.state) && !r.locked ? (
                  <button type="button" onClick={() => queue.cancel(r.key)} data-testid="album-upload-cancel" className="min-h-9 rounded-sm border border-cream-line px-2 text-xs hover:border-danger">
                    إلغاء
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {counts ? (
        <p role="status" data-testid="album-upload-summary" className="text-sm font-medium">
          {counts}
        </p>
      ) : null}
    </div>
  );
}
