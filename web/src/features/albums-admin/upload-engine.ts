import * as tus from "tus-js-client";
import { createClient } from "@/lib/supabase/browser";
import { publicEnv } from "@/lib/env/public";
import { cancelAlbumUpload, completeAlbumUpload, getPhotoStatuses, reserveAlbumUpload, retryPhoto, type PhotoStatus } from "./actions";
import { photoErrorText } from "./photo-errors";
import { ALBUM_BUCKET, ALBUM_UPLOAD_CONCURRENCY, checkAlbumFileContent, fileSha256, type FormatId } from "./rules";

/**
 * Browser upload queue for album photos (admin). Per file:
 *   check (first 64 bytes + size by kind) → sha256 (streamed, 4 MB slices) → reserve (server action) →
 *   TUS resumable upload straight to Supabase Storage (6 MB chunks, the admin's own JWT refreshed before every
 *   request, exponential backoff) → complete (server checks the stored object) → poll until ready/failed.
 * At most `concurrency` files are in flight; a failing file never stops the others. Files are never read into
 * memory whole (hash and upload both read slices).
 * Resume: TUS keeps the partial upload under a fingerprint bound to the reservation path; choosing the same file
 * again (even after a reload) gets the same reservation from the server and continues where it stopped.
 */
export type ItemState = "waiting" | "checking" | "uploading" | "processing" | "ready" | "failed" | "skipped" | "canceled";
export type UploadItem = {
  key: string;
  name: string;
  size: number;
  state: ItemState;
  /** bytes sent so far (0..size) */
  sent: number;
  message: string;
  warning?: string;
  photoId?: string;
  format?: FormatId;
  resumed?: boolean;
  /** where it failed: before/while uploading (needs the file) or during server processing (retry server-side) */
  failedAt?: "upload" | "processing";
  file?: File;
};

const CHUNK = 6 * 1024 * 1024; // Supabase TUS requires 6 MB chunks
const RETRY_DELAYS = [0, 1000, 3000, 6000, 12000, 20000];
const POLL_MS = 2500;

/** Hosted projects: the direct storage hostname is recommended for large uploads (bypasses the API gateway). */
function storageBase(): string {
  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
  const m = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/);
  return m ? `https://${m[1]}.storage.supabase.co` : url;
}

export class AlbumUploadQueue {
  items: UploadItem[] = [];
  private uploads = new Map<string, tus.Upload>();
  private active = 0;
  private poll: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private readyAt = 0;
  private supabase = createClient();

  constructor(
    private albumId: string,
    private onChange: (items: UploadItem[]) => void,
    private onReady: () => void = () => {},
    private concurrency = ALBUM_UPLOAD_CONCURRENCY,
  ) {}

  /** In-flight work (warn before leaving the page). */
  get busy(): boolean {
    return this.items.some((i) => i.state === "checking" || i.state === "uploading" || i.state === "waiting");
  }

  add(files: File[]) {
    for (const file of files) {
      this.items.push({ key: `u${Date.now().toString(36)}-${this.seq++}`, name: file.name, size: file.size, state: "waiting", sent: 0, message: "", file });
    }
    this.emit();
    this.pump();
  }

  /** Rows from an earlier session that are not finished (shown so the admin knows what to re-choose / retry). */
  addPrevious(list: PhotoStatus[]) {
    for (const s of list) {
      if (this.items.some((i) => i.photoId === s.id)) continue;
      const base = { key: `db-${s.id}`, name: `صورة من جلسة سابقة (${s.id.slice(0, 8)})`, size: 0, sent: 0, photoId: s.id };
      if (s.status === "uploading") this.items.push({ ...base, state: "failed", failedAt: "upload", message: "الرفع لم يكتمل — اختر نفس الملف مرة ثانية ليُستكمل من حيث توقّف." });
      else if (s.status === "failed") this.items.push({ ...base, state: "failed", failedAt: "processing", message: photoErrorText(s.error) });
      else this.items.push({ ...base, state: s.status === "ready" ? "ready" : "processing", message: "" });
    }
    this.emit();
    this.ensurePolling();
  }

  cancel(key: string) {
    const it = this.items.find((i) => i.key === key);
    if (!it || !["waiting", "checking", "uploading"].includes(it.state)) return;
    const up = this.uploads.get(key);
    this.uploads.delete(key);
    this.set(it, { state: "canceled", message: "أُلغي الرفع." });
    if (up) void up.abort(true).catch(() => undefined);
    if (it.photoId) void cancelAlbumUpload(it.photoId).catch(() => undefined);
  }

  cancelAll() {
    for (const it of [...this.items]) this.cancel(it.key);
  }

  async retry(key: string) {
    const it = this.items.find((i) => i.key === key);
    if (!it || it.state !== "failed") return;
    if (it.failedAt === "processing" && it.photoId) {
      this.set(it, { state: "processing", message: "" });
      this.apply(await retryPhoto(this.albumId, it.photoId).catch(() => []));
      this.ensurePolling();
      return;
    }
    if (!it.file) return;
    this.set(it, { state: "waiting", message: "", sent: 0, failedAt: undefined });
    this.pump();
  }

  dispose() {
    if (this.poll) clearInterval(this.poll);
    for (const up of this.uploads.values()) void up.abort(false).catch(() => undefined);
  }

  // ------------------------------------------------------------------ internals
  private emit() {
    this.onChange(this.items.map((i) => ({ ...i })));
  }
  private set(it: UploadItem, p: Partial<UploadItem>) {
    Object.assign(it, p);
    this.emit();
  }

  private pump() {
    while (this.active < this.concurrency) {
      const next = this.items.find((i) => i.state === "waiting" && i.file);
      if (!next) break;
      this.active++;
      next.state = "checking";
      this.emit();
      void this.run(next).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async run(it: UploadItem) {
    const file = it.file!;
    // `cancel()` may flip the state from outside while we await.
    const canceled = () => (it.state as ItemState) === "canceled";
    try {
      const checked = await checkAlbumFileContent(file);
      if ("error" in checked) return this.set(it, { state: "failed", failedAt: "upload", message: checked.error });
      const sha256 = await fileSha256(file);
      if (canceled()) return;
      const r = await reserveAlbumUpload(this.albumId, { name: file.name, size: file.size, sha256, format: checked.format });
      if (canceled()) return;
      if (!r.ok) return this.set(it, { state: r.skipped ? "skipped" : "failed", failedAt: "upload", message: r.message });
      this.set(it, { state: "uploading", photoId: r.photoId, format: checked.format, warning: r.warning, resumed: r.resumed, message: r.resumed ? "يُستكمل رفع سابق…" : "" });
      await this.tusUpload(it, file, r.path, r.contentType);
      if (canceled()) return;
      const done = await completeAlbumUpload(r.photoId);
      if (!done.ok) return this.set(it, { state: "failed", failedAt: "upload", message: done.message ?? "تعذّر تأكيد الرفع." });
      this.set(it, { state: "processing", sent: it.size, message: "" });
      this.ensurePolling();
    } catch (e) {
      if (canceled()) return;
      this.set(it, { state: "failed", failedAt: "upload", message: e instanceof Error && e.message ? e.message : "انقطع الرفع." });
    }
  }

  private async token(): Promise<string> {
    const { data } = await this.supabase.auth.getSession();
    const t = data.session?.access_token;
    if (!t) throw new Error("انتهت الجلسة — سجّل الدخول من جديد ثم أعد المحاولة.");
    return t;
  }

  private tusUpload(it: UploadItem, file: File, path: string, contentType: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `${storageBase()}/storage/v1/upload/resumable`,
        retryDelays: RETRY_DELAYS,
        chunkSize: CHUNK,
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        // One stored resume point per reservation (album + photo id), never shared across albums.
        fingerprint: async () => `sultan-album:${path}:${file.size}:${file.lastModified}`,
        headers: { "x-upsert": "false", apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
        metadata: { bucketName: ALBUM_BUCKET, objectName: path, contentType, cacheControl: "3600" },
        onBeforeRequest: async (req) => {
          req.setHeader("authorization", `Bearer ${await this.token()}`);
        },
        onShouldRetry: (err) => {
          const status = (err as tus.DetailedError).originalResponse?.getStatus?.() ?? 0;
          // 401: token refreshed on the next attempt; 403 (permission revoked / not reserved), 413 (too big),
          // 400/409 (bad or duplicate object) will not get better by retrying.
          return !(status === 403 || status === 413 || status === 400 || status === 409);
        },
        onProgress: (sent) => {
          it.sent = sent;
          this.emit();
        },
        onError: (err) => {
          this.uploads.delete(it.key);
          const status = (err as tus.DetailedError).originalResponse?.getStatus?.() ?? 0;
          reject(
            new Error(
              status === 403
                ? "لا توجد صلاحية للرفع إلى هذا الألبوم (انتهت الجلسة أو تغيّرت الصلاحية)."
                : status === 413
                  ? "الملف أكبر من الحد المسموح على الخادم."
                  : "انقطع الرفع بعد عدة محاولات — اضغط «إعادة المحاولة» ليُستكمل من حيث توقّف.",
            ),
          );
        },
        onSuccess: () => {
          this.uploads.delete(it.key);
          resolve();
        },
      });
      this.uploads.set(it.key, upload);
      upload
        .findPreviousUploads()
        .then((prev) => {
          if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
          upload.start();
        })
        .catch(() => upload.start());
    });
  }

  private apply(list: PhotoStatus[]) {
    let readied = false;
    for (const s of list) {
      const it = this.items.find((i) => i.photoId === s.id);
      if (!it || it.state === "canceled") continue;
      if (s.status === "ready" && it.state !== "ready") {
        it.state = "ready";
        it.message = "";
        readied = true;
      } else if (s.status === "failed" && it.state === "processing") {
        it.state = "failed";
        it.failedAt = "processing";
        it.message = photoErrorText(s.error);
      }
    }
    this.emit();
    // Let the album grid show newly ready photos, at most every 3 s.
    if (readied && Date.now() - this.readyAt > 3000) {
      this.readyAt = Date.now();
      this.onReady();
    }
  }

  private ensurePolling() {
    if (this.poll) return;
    this.poll = setInterval(async () => {
      const ids = this.items.filter((i) => i.state === "processing" && i.photoId).map((i) => i.photoId!);
      if (!ids.length) {
        clearInterval(this.poll!);
        this.poll = null;
        return;
      }
      this.apply(await getPhotoStatuses(this.albumId, ids).catch(() => []));
    }, POLL_MS);
  }
}
