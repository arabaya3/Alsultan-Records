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
 *
 * Cancel / dispose: every in-flight file is a Task whose awaits race a stop signal, so a cancelled file ends its
 * run (and frees its slot) at once even when TUS or a server action never answers; callbacks arriving later are
 * ignored. A reservation that arrives after a cancel is released on the server. Once the upload is confirmed
 * (complete in flight) a file can no longer be cancelled — a stored, accepted original is never deleted by a race.
 * dispose() (editor unmounted) stops transfers resumably (no server-side release) and emits nothing more;
 * attach() picks the queue up again (React StrictMode re-mount).
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
  /** upload finished, server confirmation in flight: no longer cancellable */
  locked?: boolean;
  /** where it failed: before/while uploading (needs the file) or during server processing (retry server-side) */
  failedAt?: "upload" | "processing";
  file?: File;
};

type Task = {
  it: UploadItem;
  phase: "prepare" | "upload" | "commit";
  stopped: null | "cancel" | "dispose";
  /** rejects when the task is stopped; every await of the run races it */
  stop: Promise<never>;
  kill: (why: "cancel" | "dispose") => void;
  upload?: tus.Upload;
  released?: boolean;
};

class Stopped extends Error {}

const CHUNK = 6 * 1024 * 1024; // Supabase TUS requires 6 MB chunks
const RETRY_DELAYS = [0, 1000, 3000, 6000, 12000, 20000];
const POLL_MS = 2500;
/** TUS stores a resume point only once the server has acknowledged the first 6 MB chunk; before that, the same
 *  file starts again from zero (still on the same reservation, so no duplicate row). Never promise more. */
export const RESUME_HINT = "سنستكمل الأجزاء المحفوظة، وقد يبدأ الرفع من جديد إذا لم يُحفظ أي جزء.";

/** Hosted projects: the direct storage hostname is recommended for large uploads (bypasses the API gateway). */
function storageBase(): string {
  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
  const m = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/);
  return m ? `https://${m[1]}.storage.supabase.co` : url;
}

export class AlbumUploadQueue {
  items: UploadItem[] = [];
  private tasks = new Map<string, Task>();
  private active = 0;
  private poll: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private seq = 0;
  private readyAt = 0;
  private disposed = false;
  private supabase = createClient();
  private pollMs: number;

  constructor(
    private albumId: string,
    private onChange: (items: UploadItem[]) => void,
    private onReady: () => void = () => {},
    private concurrency = ALBUM_UPLOAD_CONCURRENCY,
    opts: { pollMs?: number } = {},
  ) {
    this.pollMs = opts.pollMs ?? POLL_MS;
  }

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

  /** Rows from an earlier session that are not finished (shown so the admin knows what to re-choose / retry).
   *  May arrive after the same file was already re-chosen: a photo the queue knows is never added twice. */
  addPrevious(list: PhotoStatus[]) {
    for (const s of list) {
      if (this.items.some((i) => i.photoId === s.id)) continue;
      const base = { key: `db-${s.id}`, name: `صورة من جلسة سابقة (${s.id.slice(0, 8)})`, size: 0, sent: 0, photoId: s.id };
      if (s.status === "uploading") this.items.push({ ...base, state: "failed", failedAt: "upload", message: `الرفع لم يكتمل — أعد اختيار نفس الملف؛ ${RESUME_HINT}` });
      else if (s.status === "failed") this.items.push({ ...base, state: "failed", failedAt: "processing", message: photoErrorText(s.error) });
      else this.items.push({ ...base, state: s.status === "ready" ? "ready" : "processing", message: "" });
    }
    this.emit();
    this.ensurePolling();
  }

  cancel(key: string) {
    const it = this.items.find((i) => i.key === key);
    if (!it || !["waiting", "checking", "uploading"].includes(it.state)) return;
    const task = this.tasks.get(key);
    if (task?.phase === "commit") return; // upload confirmed: the original is kept and processed
    this.set(it, { state: "canceled", message: "أُلغي الرفع.", locked: false });
    task?.kill("cancel");
  }

  cancelAll() {
    for (const it of [...this.items]) this.cancel(it.key);
  }

  async retry(key: string) {
    const it = this.items.find((i) => i.key === key);
    if (!it || it.state !== "failed") return;
    if (it.failedAt === "processing" && it.photoId) {
      this.set(it, { state: "processing", message: "" });
      let list: PhotoStatus[];
      try {
        list = await retryPhoto(this.albumId, it.photoId);
      } catch {
        if ((it.state as ItemState) === "processing") this.set(it, { state: "failed", failedAt: "processing", message: "تعذّر طلب إعادة المحاولة — تحقّق من الاتصال ثم أعد المحاولة." });
        return;
      }
      this.apply(list);
      this.ensurePolling();
      return;
    }
    if (!it.file) return;
    this.set(it, { state: "waiting", message: "", sent: 0, failedAt: undefined });
    this.pump();
  }

  /** Editor unmounted: stop polling and transfers (resumable: reservations are kept for a later re-choice),
   *  start nothing new and emit nothing. Uploads already confirmed finish their server call quietly. */
  dispose() {
    this.disposed = true;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    for (const t of this.tasks.values()) {
      if (t.phase === "commit") continue;
      t.kill("dispose");
      Object.assign(t.it, { state: "waiting", sent: 0, message: "", locked: false });
    }
  }

  /** Re-mount after dispose() (React StrictMode runs effects twice): continue where the queue stopped. */
  attach() {
    if (!this.disposed) return;
    this.disposed = false;
    this.emit();
    this.pump();
    this.ensurePolling();
  }

  // ------------------------------------------------------------------ internals
  private emit() {
    if (this.disposed) return;
    this.onChange(this.items.map((i) => ({ ...i })));
  }
  private set(it: UploadItem, p: Partial<UploadItem>) {
    Object.assign(it, p);
    this.emit();
  }

  private pump() {
    while (!this.disposed && this.active < this.concurrency) {
      const next = this.items.find((i) => i.state === "waiting" && i.file && !this.tasks.has(i.key));
      if (!next) break;
      this.active++;
      next.state = "checking";
      this.emit();
      const task = this.newTask(next);
      let freed = false;
      void this.run(task).finally(() => {
        if (freed) return;
        freed = true;
        if (this.tasks.get(next.key) === task) this.tasks.delete(next.key);
        this.active--;
        this.pump();
      });
    }
  }

  private newTask(it: UploadItem): Task {
    let reject!: (e: unknown) => void;
    const stop = new Promise<never>((_, b) => (reject = b));
    stop.catch(() => undefined);
    const task: Task = {
      it,
      phase: "prepare",
      stopped: null,
      stop,
      kill: (why) => {
        if (task.stopped) return;
        task.stopped = why;
        reject(new Stopped());
        // cancel: drop the partial upload too; dispose: keep it resumable
        if (task.upload) void task.upload.abort(why === "cancel").catch(() => undefined);
        if (why === "cancel") this.release(task);
      },
    };
    this.tasks.set(it.key, task);
    return task;
  }

  /** Release the server reservation of a cancelled file (only while it is still `uploading` — the server checks). */
  private release(task: Task) {
    if (task.released || !task.it.photoId || task.stopped !== "cancel") return;
    task.released = true;
    void cancelAlbumUpload(task.it.photoId).catch(() => undefined);
  }

  /** Await `p` unless the task is stopped first. */
  private guard<T>(task: Task, p: Promise<T>): Promise<T> {
    if (task.stopped) return Promise.reject(new Stopped());
    return Promise.race([p, task.stop]);
  }

  /** Two rows for one photo (a row from an earlier session + the re-chosen file): keep the live one. */
  private absorb(it: UploadItem, photoId: string): "ok" | "busy" {
    for (const o of this.items) {
      if (o === it || o.photoId !== photoId) continue;
      if (this.tasks.has(o.key)) return "busy"; // the same file is already uploading in this queue
    }
    this.items = this.items.filter((o) => o === it || o.photoId !== photoId);
    return "ok";
  }

  private async run(task: Task) {
    const it = task.it;
    const file = it.file!;
    try {
      const checked = await this.guard(task, checkAlbumFileContent(file));
      if ("error" in checked) return this.set(it, { state: "failed", failedAt: "upload", message: checked.error });
      const sha256 = await this.guard(task, fileSha256(file));
      const reserving = reserveAlbumUpload(this.albumId, { name: file.name, size: file.size, sha256, format: checked.format });
      // Whenever the reservation lands, a file cancelled meanwhile gives it back (no orphan `uploading` row).
      void reserving
        .then((r) => {
          if (!r.ok || !task.stopped) return;
          if (!it.photoId) it.photoId = r.photoId;
          this.release(task);
        })
        .catch(() => undefined);
      const r = await this.guard(task, reserving);
      if (!r.ok) {
        const prev = r.photoId
          ? this.items.find((o) => o !== it && o.photoId === r.photoId && !this.tasks.has(o.key) && (o.state === "failed" || o.state === "processing"))
          : undefined;
        if (prev) {
          // Already stored but unfinished (e.g. processing failed earlier): this choice merges into that row.
          // A finished photo stays a plain duplicate («تم التخطي»).
          this.items = this.items.filter((o) => o !== prev);
          return this.set(it, { state: prev.state, failedAt: prev.failedAt, message: prev.message, photoId: prev.photoId, file: prev.state === "failed" && prev.failedAt === "upload" ? file : undefined });
        }
        return this.set(it, { state: r.skipped ? "skipped" : "failed", failedAt: "upload", message: r.message, photoId: r.skipped ? r.photoId : undefined });
      }
      if (this.absorb(it, r.photoId) === "busy") return this.set(it, { state: "skipped", message: "الملف نفسه قيد الرفع في صف آخر." });
      this.set(it, { state: "uploading", photoId: r.photoId, format: checked.format, warning: r.warning, resumed: r.resumed, message: r.resumed ? "متابعة رفع سابق لنفس الملف…" : "" });
      task.phase = "upload";
      await this.guard(task, this.tusUpload(task, file, r.path, r.contentType));
      task.phase = "commit"; // from here on the upload is kept (cancel() ignores it)
      this.set(it, { locked: true, sent: it.size });
      const done = await completeAlbumUpload(r.photoId).catch(() => ({ ok: false, message: "تعذّر تأكيد الرفع — تحقّق من الاتصال ثم أعد المحاولة." }));
      if (!done.ok) return this.set(it, { state: "failed", failedAt: "upload", locked: false, message: done.message ?? "تعذّر تأكيد الرفع." });
      this.set(it, { state: "processing", locked: false, sent: it.size, message: "" });
      this.ensurePolling();
    } catch (e) {
      if (e instanceof Stopped || task.stopped) return;
      this.set(it, { state: "failed", failedAt: "upload", locked: false, message: e instanceof Error && e.message ? e.message : "انقطع الرفع." });
    }
  }

  private async token(): Promise<string> {
    const { data } = await this.supabase.auth.getSession();
    const t = data.session?.access_token;
    if (!t) throw new Error("انتهت الجلسة — سجّل الدخول من جديد ثم أعد المحاولة.");
    return t;
  }

  private tusUpload(task: Task, file: File, path: string, contentType: string): Promise<void> {
    const it = task.it;
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
          if (task.stopped) return false;
          const status = (err as tus.DetailedError).originalResponse?.getStatus?.() ?? 0;
          // 401: token refreshed on the next attempt; 403 (permission revoked / not reserved), 413 (too big),
          // 400/409 (bad or duplicate object) will not get better by retrying.
          return !(status === 403 || status === 413 || status === 400 || status === 409);
        },
        onProgress: (sent) => {
          if (task.stopped) return;
          it.sent = sent;
          this.emit();
        },
        onError: (err) => {
          if (task.stopped) return;
          const status = (err as tus.DetailedError).originalResponse?.getStatus?.() ?? 0;
          reject(
            new Error(
              status === 403
                ? "لا توجد صلاحية للرفع إلى هذا الألبوم (انتهت الجلسة أو تغيّرت الصلاحية)."
                : status === 413
                  ? "الملف أكبر من الحد المسموح على الخادم."
                  : `انقطع الرفع بعد عدة محاولات — اضغط «إعادة المحاولة»؛ ${RESUME_HINT}`,
            ),
          );
        },
        onSuccess: () => {
          if (task.stopped) return;
          resolve();
        },
      });
      task.upload = upload;
      upload
        .findPreviousUploads()
        .then((prev) => {
          if (task.stopped) return;
          if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
          upload.start();
        })
        .catch(() => {
          if (!task.stopped) upload.start();
        });
    });
  }

  private apply(list: PhotoStatus[], asked: string[] = []) {
    let readied = false;
    for (const s of list) {
      for (const it of this.items) {
        if (it.photoId !== s.id || it.state === "canceled") continue;
        if (s.status === "ready" && it.state !== "ready") {
          Object.assign(it, { state: "ready", message: "" });
          readied = true;
        } else if (s.status === "failed" && it.state === "processing") {
          Object.assign(it, { state: "failed", failedAt: "processing", message: photoErrorText(s.error) });
        }
      }
    }
    // Asked about but not returned: the photo no longer exists (deleted elsewhere) — stop following it.
    const seen = new Set(list.map((s) => s.id));
    for (const id of asked) {
      if (seen.has(id)) continue;
      for (const it of this.items) {
        if (it.photoId === id && it.state === "processing") Object.assign(it, { state: "failed", failedAt: undefined, message: "تعذّرت متابعة حالة الصورة (ربما حُذفت) — حدّث الصفحة." });
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
    if (this.poll || this.disposed) return;
    this.poll = setInterval(async () => {
      if (this.polling) return;
      const ids = [...new Set(this.items.filter((i) => i.state === "processing" && i.photoId).map((i) => i.photoId!))];
      if (!ids.length || this.disposed) {
        if (this.poll) clearInterval(this.poll);
        this.poll = null;
        return;
      }
      this.polling = true;
      try {
        const list = await getPhotoStatuses(this.albumId, ids).catch(() => null);
        if (list && !this.disposed) this.apply(list, ids);
      } finally {
        this.polling = false;
      }
    }, this.pollMs);
  }
}
