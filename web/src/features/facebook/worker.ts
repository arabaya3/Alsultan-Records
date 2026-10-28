import { GraphError, graphClient, phaseDone, type Fetch } from "./graph";

export type Job = {
  id: string;
  reel_video_id: string | null;
  caption: string | null;
  page_id: string | null;
  meta_video_id: string | null;
  meta_post_id: string | null;
  attempts: number;
};

export type JobPatch = {
  status: "awaiting_connection" | "queued" | "publishing" | "published" | "failed";
  meta_video_id?: string;
  meta_post_id?: string;
  last_error?: string | null;
  next_attempt_at?: string;
  published_at?: string;
};

export type Deps = {
  fetch: Fetch;
  token: string | null;
  pageId: string | null;
  /** Signed, short-lived URL of the private clip (reel-media), or null when the file is gone. */
  signedFileUrl: (reelVideoId: string) => Promise<string | null>;
  /** Persist a patch immediately (meta_video_id is saved BEFORE uploading, so a retry resumes the same upload). */
  save: (id: string, patch: JobPatch) => Promise<void>;
  /** The Page token stopped working: forget it and show «انتهى الربط» to the owner. */
  connectionLost: (reason: string) => Promise<void>;
  now?: () => Date;
};

export const MAX_ATTEMPTS = 5;
const backoffMinutes = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1));

/**
 * One claimed job → one step towards «published». Safe to run again at any point:
 *  - never calls `start` twice (meta_video_id is stored first);
 *  - asks Meta for the status before `finish`, so a publish that succeeded but whose response was lost is recorded,
 *    not published a second time;
 *  - a lost/expired token parks the job as awaiting_connection (keeps meta_video_id), it is not a failure;
 *  - Meta-side/transient errors retry with backoff up to MAX_ATTEMPTS, then «failed» with a readable reason.
 * The site itself is never touched: a Facebook failure cannot unpublish anything locally.
 */
export async function runJob(job: Job, d: Deps): Promise<JobPatch> {
  const now = (d.now ?? (() => new Date()))();
  const done = async (p: JobPatch) => {
    await d.save(job.id, p);
    return p;
  };
  if (job.meta_post_id) return done({ status: "published", meta_post_id: job.meta_post_id });
  if (!d.token || !d.pageId) return done({ status: "awaiting_connection" });
  if (!job.reel_video_id) return done({ status: "failed", last_error: "حُذف المقطع من الموقع قبل نشره على فيسبوك." });

  const g = graphClient(d.fetch, d.token);
  let videoId = job.meta_video_id;
  try {
    if (!videoId) {
      videoId = (await g.start(d.pageId)).video_id;
      await d.save(job.id, { status: "publishing", meta_video_id: videoId });
    }
    const st = (await g.status(videoId)).status ?? {};
    if (phaseDone(st.publishing_phase)) {
      return done({ status: "published", meta_post_id: videoId, published_at: now.toISOString(), last_error: null });
    }
    if (!phaseDone(st.uploading_phase)) {
      const url = await d.signedFileUrl(job.reel_video_id);
      if (!url) return done({ status: "failed", last_error: "ملف المقطع غير موجود في التخزين." });
      await g.uploadHosted(videoId, url);
    }
    const fin = await g.finish(d.pageId, videoId, job.caption);
    if (!fin.success) throw new GraphError("finish not accepted", 500, null, null);
    // Meta returns the reel's id; processing continues on Meta's side. The reel id is the post handle we keep.
    return done({ status: "published", meta_video_id: videoId, meta_post_id: fin.post_id ?? videoId, published_at: now.toISOString(), last_error: null });
  } catch (e) {
    const err = e instanceof GraphError ? e : new GraphError("unexpected error", 500, null, null);
    if (err.authLost) {
      await d.connectionLost(err.message);
      return done({ status: "awaiting_connection", last_error: "انتهى ربط صفحة فيسبوك أو سُحبت الصلاحية. أعد الربط من الإعدادات." });
    }
    if (err.transient && job.attempts < MAX_ATTEMPTS) {
      const next = new Date(now.getTime() + backoffMinutes(job.attempts) * 60_000).toISOString();
      return done({ status: "queued", last_error: err.message, next_attempt_at: next });
    }
    return done({ status: "failed", last_error: err.message });
  }
}
