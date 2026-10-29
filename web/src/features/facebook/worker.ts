import { GraphError, graphClient, phaseDone, reelFailed, type Fetch } from "./graph";

export type Job = {
  id: string;
  reel_video_id: string | null;
  caption: string | null;
  page_id: string | null;
  meta_video_id: string | null;
  finish_requested_at?: string | null;
  meta_post_id: string | null;
  attempts: number;
  /** Set by claim_facebook_jobs (0030): this worker's lease; every save is conditioned on it. */
  lease_token?: string | null;
};

export type JobPatch = {
  status: "awaiting_connection" | "queued" | "publishing" | "processing" | "published" | "failed" | "page_changed";
  meta_video_id?: string;
  finish_requested_at?: string;
  meta_post_id?: string;
  last_error?: string | null;
  next_attempt_at?: string;
  published_at?: string;
};

export type Deps = {
  fetch: Fetch;
  token: string | null;
  /** The CONNECTED Page. A job is only ever sent to its own approved page_id, and only while that Page is connected. */
  pageId: string | null;
  /** Signed, short-lived URL of the private clip (reel-media), or null when the file is gone. */
  signedFileUrl: (reelVideoId: string) => Promise<string | null>;
  /**
   * Persist a patch immediately (meta_video_id is saved BEFORE uploading, so a retry resumes the same upload).
   * MUST throw (SaveError) when the database errors or the row was not updated: the next Meta request depends on it.
   */
  save: (id: string, patch: JobPatch) => Promise<void>;
  /** The Page token stopped working: forget it and show «انتهى الربط» to the owner. */
  connectionLost: (reason: string) => Promise<void>;
  now?: () => Date;
};

export const MAX_ATTEMPTS = 5;
const backoffMinutes = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1));

/** Saving the job's state failed: nothing more may be sent to Meta in this run. */
export class SaveError extends Error {}

const PAGE_CHANGED = "الصفحة المربوطة الآن ليست الصفحة التي طُلب النشر عليها. أعد ربط تلك الصفحة أو أكّد النشر على الصفحة الحالية.";
const NO_PAGE = "طُلب النشر قبل ربط أي صفحة. أكّد النشر على الصفحة المربوطة الآن من جديد.";

/**
 * One claimed job → one step towards «published». Safe to run again at any point:
 *  - goes only to the job's approved page_id; another (or no) approved Page → 'page_changed', no request sent;
 *  - never calls `start` twice for a stored meta_video_id; every state is saved (and the save checked) BEFORE the
 *    next Meta request that depends on it, so a failed save stops the run with nothing more sent;
 *  - stores finish_requested_at BEFORE sending `finish`; once set, `finish` is NEVER sent again for this job;
 *  - an accepted `finish` is only 'processing': 'published' is written when Meta's status says publishing completed,
 *    'failed' when Meta reports an error or never confirms within MAX_ATTEMPTS checks (owner checks the Page);
 *  - a lost/expired token parks the job as awaiting_connection (keeps meta_video_id), it is not a failure;
 *  - Meta-side/transient errors (incl. a per-request timeout) retry with backoff up to MAX_ATTEMPTS.
 * Limits of the no-duplicate guarantee (see docs §5): a `start` whose id could not be saved leaves an unused upload
 * session on Meta (never finished, so never posted); and Meta itself offers no idempotency key, so if Meta published
 * but its status endpoint never reports it, the job ends «failed» and a manual re-request by the owner could post twice.
 * The site itself is never touched: a Facebook failure cannot unpublish anything locally.
 */
export async function runJob(job: Job, d: Deps): Promise<JobPatch> {
  const now = (d.now ?? (() => new Date()))();
  const done = async (p: JobPatch) => {
    await d.save(job.id, p);
    return p;
  };
  const later = (attempts: number) => new Date(now.getTime() + backoffMinutes(attempts) * 60_000).toISOString();
  if (job.meta_post_id) return done({ status: "published", meta_post_id: job.meta_post_id });
  if (!d.token || !d.pageId) return done({ status: "awaiting_connection" });
  if (!job.page_id) return done({ status: "page_changed", last_error: NO_PAGE });
  if (job.page_id !== d.pageId) return done({ status: "page_changed", last_error: PAGE_CHANGED });
  if (!job.reel_video_id) return done({ status: "failed", last_error: "حُذف المقطع من الموقع قبل نشره على فيسبوك." });

  const pageId = job.page_id;
  const g = graphClient(d.fetch, d.token);
  let videoId = job.meta_video_id;
  let finishMarked = Boolean(job.finish_requested_at);
  try {
    if (!videoId) {
      videoId = (await g.start(pageId)).video_id;
      await d.save(job.id, { status: "publishing", meta_video_id: videoId });
    }
    const st = (await g.status(videoId)).status ?? {};
    if (phaseDone(st.publishing_phase)) {
      return done({ status: "published", meta_post_id: videoId, published_at: now.toISOString(), last_error: null });
    }
    if (job.finish_requested_at) {
      // `finish` was already sent once (its reply may have been lost): only the status decides, never a second finish.
      if (reelFailed(st)) {
        return done({ status: "failed", last_error: "أرسلنا طلب النشر لفيسبوك ولم يكتمل. افحص الصفحة قبل أي محاولة جديدة." });
      }
      if (job.attempts >= MAX_ATTEMPTS) {
        return done({ status: "failed", last_error: "لم يؤكد فيسبوك النشر بعد عدة فحوص. افحص الصفحة قبل أي محاولة جديدة." });
      }
      return done({ status: "processing", last_error: null, next_attempt_at: later(job.attempts) });
    }
    if (!phaseDone(st.uploading_phase)) {
      const url = await d.signedFileUrl(job.reel_video_id);
      if (!url) return done({ status: "failed", last_error: "ملف المقطع غير موجود في التخزين." });
      await g.uploadHosted(videoId, url);
    }
    await d.save(job.id, { status: "publishing", finish_requested_at: now.toISOString() });
    finishMarked = true;
    const fin = await g.finish(pageId, videoId, job.caption);
    if (!fin.success) throw new GraphError("finish not accepted", 500, null, null);
    // Accepted, not yet published: Meta keeps processing. The next run reads the status before showing «منشور».
    return done({ status: "processing", meta_video_id: videoId, last_error: null, next_attempt_at: later(1) });
  } catch (e) {
    if (e instanceof SaveError) throw e;
    const err = e instanceof GraphError ? e : new GraphError("unexpected error", 500, null, null);
    if (err.authLost) {
      await d.connectionLost(err.message);
      return done({ status: "awaiting_connection", last_error: "انتهى ربط صفحة فيسبوك أو سُحبت الصلاحية. أعد الربط من الإعدادات." });
    }
    if (err.transient && job.attempts < MAX_ATTEMPTS) {
      return done({ status: finishMarked ? "processing" : "queued", last_error: err.message, next_attempt_at: later(job.attempts) });
    }
    return done({ status: "failed", last_error: err.message });
  }
}
