"use client";

import { photoErrorText } from "./photo-errors";
import { useCallback, useEffect, useRef, useState } from "react";
import { ALBUM_ACCEPT, ALBUM_BUCKET, ALBUM_MAX_FILES_PER_BATCH, checkAlbumFile, fileSha256 } from "./rules";
import {
  discardFailedUpload,
  getUnfinishedPhotos,
  prepareAlbumUploads,
  processUploadedPhotos,
  refreshAlbum,
  retryPhoto,
  type PhotoStatus,
} from "./actions";

type State = "waiting" | "hashing" | "uploading" | "pending" | "processing" | "ready" | "failed" | "skipped";
type Row = {
  key: string;
  name: string;
  state: State;
  message: string;
  progress: number;
  photoId?: string;
  file?: File;
  /** failed before the original reached storage → retry re-uploads the file */
  uploadFailed?: boolean;
  warning?: string;
  fromDb?: boolean;
};

const LABEL: Record<State, string> = {
  waiting: "بانتظار",
  hashing: "بانتظار · فحص التكرار…",
  uploading: "يُرفع",
  pending: "بانتظار المعالجة",
  processing: "قيد المعالجة",
  ready: "جاهز",
  failed: "فشل",
  skipped: "تم التخطي",
};
const PROCESS_CHUNK = 8;
const POLL_MS = 5000;

/** PUT to the signed upload URL with XHR so we get real per-file progress. */
function putSigned(path: string, token: string, file: File, onProgress: (p: number) => void): Promise<boolean> {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const url = `${base}/storage/v1/object/upload/sign/${ALBUM_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}?token=${encodeURIComponent(token)}`;
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("cache-control", "max-age=31536000");
    if (key) xhr.setRequestHeader("apikey", key);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);
    xhr.send(file);
  });
}

/**
 * Bulk upload. The browser only uploads originals (signed URLs into the private bucket); the server
 * produces variants in a queue (cron worker + an immediate run here for feedback). Closing the tab after
 * the uploads finish does not stop processing. On reload, unfinished photos are read back from the DB.
 */
export function AlbumUploader({ albumId }: { albumId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  // Leaving mid-upload interrupts it (the remaining photos never reach storage): ask the browser to confirm.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  const [summary, setSummary] = useState("");
  const rowsRef = useRef<Row[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const patch = (key: string, p: Partial<Row>) => setRows((r) => r.map((row) => (row.key === key ? { ...row, ...p } : row)));

  const applyStatuses = useCallback((list: PhotoStatus[]) => {
    const byId = new Map(list.map((s) => [s.id, s]));
    setRows((r) =>
      r.map((row) => {
        const s = row.photoId ? byId.get(row.photoId) : undefined;
        if (!s) return row;
        return { ...row, state: s.status, message: s.status === "failed" ? `${photoErrorText(s.error)} (محاولات: ${s.attempts})` : row.message };
      }),
    );
  }, []);

  // Resume after reload: show what is still pending/processing/failed in the DB.
  useEffect(() => {
    let alive = true;
    getUnfinishedPhotos(albumId).then((list) => {
      if (!alive || !list.length) return;
      setRows((r) => [
        ...r,
        ...list
          .filter((s) => !r.some((x) => x.photoId === s.id))
          .map((s) => ({
            key: `db-${s.id}`,
            name: `صورة من جلسة سابقة (${s.id.slice(0, 8)})`,
            state: s.status as State,
            message: s.status === "failed" ? `${photoErrorText(s.error)} (محاولات: ${s.attempts})` : "",
            progress: 100,
            photoId: s.id,
            fromDb: true,
          })),
      ]);
    });
    return () => {
      alive = false;
    };
  }, [albumId]);

  // Poll while anything is waiting for the server queue.
  const waiting = rows.some((r) => r.photoId && (r.state === "pending" || r.state === "processing"));
  useEffect(() => {
    if (!waiting || busy) return;
    const t = setInterval(async () => {
      const list = await getUnfinishedPhotos(albumId);
      const open = new Set(list.map((s) => s.id));
      const tracked = rowsRef.current.filter((r) => r.photoId && (r.state === "pending" || r.state === "processing"));
      applyStatuses([...list, ...tracked.filter((r) => !open.has(r.photoId!)).map((r) => ({ id: r.photoId!, status: "ready" as const, error: null, attempts: 0 }))]);
      if (tracked.some((r) => !open.has(r.photoId!))) await refreshAlbum();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, busy, albumId, applyStatuses]);

  async function processNow(ids: string[]) {
    for (let i = 0; i < ids.length; i += PROCESS_CHUNK) {
      const chunk = ids.slice(i, i + PROCESS_CHUNK);
      chunk.forEach((id) => setRows((r) => r.map((row) => (row.photoId === id && row.state === "pending" ? { ...row, state: "processing" } : row))));
      try {
        applyStatuses(await processUploadedPhotos(albumId, chunk));
      } catch {
        /* the cron worker will finish them */
      }
    }
  }

  async function uploadRows(targets: Row[]) {
    const prepared = await prepareAlbumUploads(
      albumId,
      targets.map((t) => ({ name: t.file!.name, type: t.file!.type, size: t.file!.size, sha256: t.message })),
    ).catch(() => ({ ok: false, message: "تعذّر الاتصال بالخادم.", items: [] as Awaited<ReturnType<typeof prepareAlbumUploads>>["items"] }));
    if (!prepared.items.length) {
      targets.forEach((t) => patch(t.key, { state: "failed", uploadFailed: true, message: prepared.message ?? "تعذّر التجهيز." }));
      return [];
    }
    const uploaded: string[] = [];
    for (let k = 0; k < prepared.items.length; k++) {
      const item = prepared.items[k];
      const t = targets[k];
      if (!item.ok) {
        patch(t.key, { state: item.skipped ? "skipped" : "failed", uploadFailed: !item.skipped, message: item.message });
        continue;
      }
      patch(t.key, { state: "uploading", photoId: item.photoId, warning: item.warning, message: "", progress: 0 });
      const okUp = await putSigned(item.path, item.token, t.file!, (p) => patch(t.key, { progress: p }));
      if (!okUp) {
        await discardFailedUpload(item.photoId).catch(() => undefined);
        patch(t.key, { state: "failed", uploadFailed: true, photoId: undefined, message: "انقطع الرفع أو رُفض الملف." });
        continue;
      }
      patch(t.key, { state: "pending", progress: 100 });
      uploaded.push(item.photoId);
    }
    return uploaded;
  }

  async function start() {
    const files = Array.from(inputRef.current?.files ?? []);
    if (!files.length) return setSummary("اختر صوراً أولاً.");
    if (files.length > ALBUM_MAX_FILES_PER_BATCH) return setSummary(`الحد ${ALBUM_MAX_FILES_PER_BATCH} صورة في كل دفعة.`);
    setBusy(true);
    setSummary("");
    const stamp = Date.now();
    const fresh: Row[] = files.map((f, i) => {
      const problem = checkAlbumFile(f);
      return { key: `${stamp}-${i}`, name: f.name, file: f, state: problem ? "failed" : "hashing", message: problem ?? "", progress: 0 };
    });
    setRows((r) => [...fresh, ...r.filter((x) => x.fromDb || x.state !== "ready")]);
    const valid = fresh.filter((r) => r.state === "hashing");
    for (const r of valid) {
      try {
        r.message = await fileSha256(r.file!); // carried to the server in `message` until prepared
        patch(r.key, { state: "waiting" });
      } catch {
        r.state = "failed";
        patch(r.key, { state: "failed", message: "تعذّرت قراءة الملف." });
      }
    }
    const ids = await uploadRows(valid.filter((r) => r.state !== "failed"));
    await processNow(ids);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    await refreshAlbum();
  }

  async function retry(row: Row) {
    setBusy(true);
    try {
      if (row.uploadFailed && row.file) {
        patch(row.key, { state: "hashing", message: "" });
        const sha = await fileSha256(row.file);
        const ids = await uploadRows([{ ...row, message: sha }]);
        await processNow(ids);
      } else if (row.photoId) {
        patch(row.key, { state: "processing", message: "" });
        applyStatuses(await retryPhoto(albumId, row.photoId));
      }
    } finally {
      setBusy(false);
      await refreshAlbum();
    }
  }

  const n = (s: State) => rows.filter((r) => r.state === s).length;
  const counts = rows.length ? `جاهز ${n("ready")} · قيد المعالجة ${n("pending") + n("processing") + n("uploading")} · تم التخطي ${n("skipped")} · فشل ${n("failed")}` : "";

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
        JPEG أو PNG أو WebP أو AVIF، حتى 25MB للصورة و{ALBUM_MAX_FILES_PER_BATCH} صورة في الدفعة. يُحفظ الأصل كما هو (لا قصّ ولا إزالة للعلامة المائية)،
        وتُنشأ نسختا العرض على الخادم — يمكنك إغلاق الصفحة بعد اكتمال الرفع وستكتمل المعالجة تلقائياً.
      </p>
      {rows.length ? (
        <ul className="divide-y divide-cream-line rounded-md border border-cream-line text-sm" aria-live="polite">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid="album-upload-row" data-state={r.state} data-photo-id={r.photoId}>
              <span className="min-w-0 truncate" dir="auto">
                {r.name}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {r.state === "uploading" ? (
                  <progress max={100} value={r.progress} className="h-2 w-24" aria-label={`تقدّم رفع ${r.name}`} />
                ) : null}
                <span className={r.state === "failed" ? "text-danger" : r.state === "ready" ? "text-success" : "text-on-cream-muted"}>
                  {LABEL[r.state]}
                  {r.state === "uploading" ? ` ${r.progress}%` : ""}
                  {r.state !== "hashing" && r.state !== "waiting" && r.message ? ` · ${r.message}` : ""}
                </span>
                {r.warning ? (
                  <span className="text-xs text-gold-press" data-testid="album-upload-warning">
                    {r.warning}
                  </span>
                ) : null}
                {r.state === "failed" && (r.photoId || (r.uploadFailed && r.file)) ? (
                  <button type="button" disabled={busy} onClick={() => retry(r)} data-testid="album-upload-retry" className="rounded-sm border border-cream-line px-2 py-1 text-xs hover:border-on-cream-muted disabled:opacity-50">
                    إعادة المحاولة
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {summary || counts ? (
        <p role="status" data-testid="album-upload-summary" className="text-sm font-medium">
          {summary || counts}
        </p>
      ) : null}
    </div>
  );
}
