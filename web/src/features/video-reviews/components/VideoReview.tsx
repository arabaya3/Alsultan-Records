"use client";

import { goToLogin } from "@/features/portal/client-nav";
import { useCallback, useEffect, useRef, useState } from "react";
import { DELIVERABLE_STATUS, dateAr, timecode } from "@/features/portal/format";
import {
  addRevisionComment,
  getRevisionVideoUrl,
  listRevisionComments,
  type VideoComment,
} from "@/features/video-reviews/actions";

type Rev = { id: string; revisionNo: number; notes: string | null; createdAt: string };


export function VideoReview({ revisions, status }: { revisions: Rev[]; status: string }) {
  const [revId, setRevId] = useState(revisions[0]?.id ?? null);
  const [src, setSrc] = useState<{ url: string | null; exp: number | null } | null>(null);
  const [videoState, setVideoState] = useState<"loading" | "ready" | "error" | "missing">("loading");
  const [comments, setComments] = useState<VideoComment[] | null>(null);
  const [commentsError, setCommentsError] = useState(false);
  const [showResolved, setShowResolved] = useState(true);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const req = useRef(0); // guards against stale responses on rapid revision switching
  const renewals = useRef(0);
  const resumeAt = useRef(0);
  const currentRev = useRef(revId);
  useEffect(() => {
    currentRev.current = revId;
  }, [revId]);

  const loadVideo = useCallback(async (id: string, resume = 0) => {
    const r = req.current;
    resumeAt.current = resume;
    const res = await getRevisionVideoUrl(id).catch(() => null);
    if (r !== req.current) return;
    if (!res) return setVideoState("error");
    if (!res.ok) return res.code === "auth" ? goToLogin() : setVideoState("error");
    setSrc({ url: res.data.url, exp: res.data.expiresAt });
    setVideoState(res.data.url ? "loading" : "missing");
  }, []);

  const loadComments = useCallback(async (id: string) => {
    const r = req.current;
    setCommentsError(false);
    const res = await listRevisionComments(id).catch(() => null);
    if (r !== req.current) return;
    if (!res || !res.ok) {
      if (res?.code === "auth") return goToLogin();
      return setCommentsError(true);
    }
    setComments(res.data);
  }, []);

  // Initial load (state already starts in "loading"/null).
  const initialRev = useRef(revId);
  useEffect(() => {
    const id = initialRev.current;
    if (!id) return;
    req.current += 1;
    void loadVideo(id);
    void loadComments(id);
  }, [loadVideo, loadComments]);

  function selectRevision(id: string) {
    if (id === revId) return;
    req.current += 1; // invalidates any in-flight responses for the previous revision
    renewals.current = 0;
    setRevId(id);
    setSrc(null);
    setComments(null);
    setVideoState("loading");
    void loadVideo(id);
    void loadComments(id);
  }

  // Renew the signed URL shortly before it expires, keeping playback position.
  useEffect(() => {
    if (!src?.exp || !revId) return;
    const ms = Math.max(5_000, src.exp - Date.now() - 60_000);
    const t = setTimeout(() => {
      const v = videoRef.current;
      void loadVideo(revId, v?.currentTime ?? 0);
    }, ms);
    return () => clearTimeout(t);
  }, [src, revId, loadVideo]);

  function onVideoError() {
    if (!revId) return;
    if (renewals.current < 1) {
      renewals.current += 1;
      void loadVideo(revId, videoRef.current?.currentTime ?? 0);
    } else setVideoState("error");
  }

  function seek(ms: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    void v.play().catch(() => undefined);
    v.focus();
  }

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!revId) return;
    const ms = Math.round((videoRef.current?.currentTime ?? 0) * 1000);
    const forRev = revId;
    setPosting(true);
    setPostError("");
    const res = await addRevisionComment({ revisionId: forRev, timecodeMs: ms, body }).catch(() => null);
    setPosting(false);
    if (res?.ok) {
      setBody("");
      if (forRev === currentRev.current) setComments((c) => [...(c ?? []), res.data].sort((a, b) => a.timecodeMs - b.timecodeMs));
      return;
    }
    if (res?.code === "auth") return goToLogin();
    setPostError(res?.error ?? "تعذّر حفظ الملاحظة. حاول مرة أخرى.");
  }

  const current = revisions.find((r) => r.id === revId);
  const visible = (comments ?? []).filter((c) => showResolved || !c.resolved);

  if (!revisions.length)
    return (
      <div role="status" className="rounded-md border border-dashed border-cream-line px-6 py-12 text-center">
        <p className="font-display text-xl font-semibold">لا توجد نسخة جاهزة بعد</p>
        <p className="mt-2 text-on-cream-muted">سنُعلمك عند رفع أول نسخة للمراجعة.</p>
      </div>
    );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="النسخ">
          {revisions.map((r, i) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={r.id === revId}
              onClick={() => selectRevision(r.id)}
              className={`min-h-11 rounded-sm px-4 text-sm ${r.id === revId ? "bg-ink text-on-dark" : "border border-cream-line hover:border-gold"}`}
            >
              النسخة {r.revisionNo}
              {i === 0 ? " (الأحدث)" : ""}
            </button>
          ))}
        </div>
        <div className="relative aspect-video overflow-hidden rounded-sm bg-ink">
          {src?.url ? (
            <video
              key={src.url}
              ref={videoRef}
              src={src.url}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full"
              data-testid="review-video"
              onLoadedMetadata={(e) => {
                setVideoState("ready");
                if (resumeAt.current) e.currentTarget.currentTime = resumeAt.current;
              }}
              onError={onVideoError}
            />
          ) : (
            <video ref={videoRef} className="hidden" aria-hidden="true" />
          )}
          {videoState !== "ready" ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-on-dark">
              {videoState === "loading" ? (
                <p className="animate-pulse text-muted">جارِ تجهيز الفيديو…</p>
              ) : (
                <div className="pointer-events-auto">
                  <p>{videoState === "missing" ? "ملف هذه النسخة غير متاح بعد." : "تعذّر تشغيل الفيديو الآن."}</p>
                  {videoState === "error" && revId ? (
                    <button
                      type="button"
                      className="mt-3 min-h-11 rounded-sm border border-ink-line px-4 hover:border-gold"
                      onClick={() => {
                        renewals.current = 0;
                        setVideoState("loading");
                        void loadVideo(revId);
                      }}
                    >
                      إعادة المحاولة
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
        {current ? (
          <p className="mt-3 text-sm text-on-cream-muted">
            {DELIVERABLE_STATUS[status] ?? ""} · رُفعت {dateAr(current.createdAt)}
            {current.notes ? ` · ${current.notes}` : ""}
          </p>
        ) : null}
      </div>

      <aside aria-labelledby="comments-h">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="comments-h" className="text-xl font-semibold">
            ملاحظاتك على النسخة {current?.revisionNo}
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            إظهار المُعالجة
          </label>
        </div>

        <form onSubmit={post} className="mb-5">
          <label htmlFor="comment" className="mb-1 block text-sm text-on-cream-muted">
            أضف ملاحظة عند اللحظة الحالية من الفيديو
          </label>
          <textarea
            id="comment"
            className="field min-h-20"
            value={body}
            maxLength={4000}
            onChange={(e) => setBody(e.target.value)}
            required
          />
          {postError ? (
            <p role="alert" className="mt-1 text-sm text-danger">
              {postError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={posting || !body.trim()}
            className="mt-2 min-h-11 rounded-sm bg-gold px-5 font-medium text-ink hover:bg-gold-press disabled:opacity-60"
          >
            {posting ? "جارِ الحفظ…" : "حفظ الملاحظة"}
          </button>
        </form>

        {commentsError ? (
          <div role="alert" className="text-danger">
            تعذّر تحميل الملاحظات.{" "}
            <button type="button" className="underline" onClick={() => revId && loadComments(revId)}>
              إعادة المحاولة
            </button>
          </div>
        ) : comments === null ? (
          <p className="animate-pulse text-on-cream-muted">جارِ التحميل…</p>
        ) : visible.length === 0 ? (
          <p className="text-on-cream-muted">لا توجد ملاحظات على هذه النسخة بعد.</p>
        ) : (
          <ol className="space-y-3" data-testid="comments">
            {visible.map((c) => (
              <li key={c.id} className={`rounded-md border p-3 ${c.resolved ? "border-success/40 bg-success/5" : "border-cream-line bg-cream-2"}`}>
                <div className="mb-1 flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    dir="ltr"
                    onClick={() => seek(c.timecodeMs)}
                    className="rounded-sm bg-ink px-2 py-0.5 font-mono text-xs text-gold"
                    aria-label={`انتقل إلى ${timecode(c.timecodeMs)}`}
                    data-testid="timecode-chip"
                  >
                    {timecode(c.timecodeMs)}
                  </button>
                  <span className="text-on-cream-muted">{c.mine ? "أنت" : "فريق الاستوديو"}</span>
                  {c.resolved ? <span className="ms-auto text-success">تمت المعالجة</span> : null}
                </div>
                <p className="whitespace-pre-line"><bdi dir="auto">{c.body}</bdi></p>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
