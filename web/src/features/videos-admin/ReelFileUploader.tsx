"use client";

import { useRef, useState } from "react";
import { uploadToS3, S3UploadDenied } from "@/features/albums-admin/s3-upload";
import { completeReelUpload, removeReelFile, reserveReelFile, signReelParts, startReelUpload } from "./reel-file-actions";

type Meta = { duration: number | null; width: number | null; height: number | null };

/** Reads the file's own duration and size in the browser (display only; the server checks the bytes). */
function readMeta(file: File): Promise<Meta> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (m: Meta) => {
      URL.revokeObjectURL(url);
      resolve(m);
    };
    v.preload = "metadata";
    v.onloadedmetadata = () => done({ duration: Number.isFinite(v.duration) ? v.duration : null, width: v.videoWidth || null, height: v.videoHeight || null });
    v.onerror = () => done({ duration: null, width: null, height: null });
    v.src = url;
  });
}

/**
 * Admin: the original video file shown in the reels viewer instead of YouTube. Upload resumes when the same file is
 * chosen again after a reload; leaving the page keeps what S3 already holds.
 */
export function ReelFileUploader({ videoId, current }: { videoId: string; current: { id: string; status: string; width: number | null; height: number | null } | null }) {
  const [state, setState] = useState<"idle" | "uploading" | "done" | "failed">("idle");
  const [sent, setSent] = useState(0);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const stop = useRef<AbortController | null>(null);

  const start = async (file: File) => {
    setState("uploading");
    setMessage("");
    setSent(0);
    setTotal(file.size);
    try {
      const meta = await readMeta(file);
      const r = await reserveReelFile(videoId, { size: file.size, mime: file.type, ...meta });
      if (!r.ok) throw new Error(r.message);
      stop.current = new AbortController();
      await uploadToS3(r.id, file, { start: startReelUpload, sign: signReelParts }, stop.current.signal, setSent);
      const done = await completeReelUpload(r.id);
      if (!done.ok) throw new Error(done.message ?? "تعذّر تأكيد الرفع.");
      setState("done");
    } catch (e) {
      setState("failed");
      setMessage(e instanceof S3UploadDenied || e instanceof Error ? e.message || "انقطع الرفع — أعد اختيار الملف للمتابعة." : "انقطع الرفع — أعد اختيار الملف للمتابعة.");
    }
  };

  if (current?.status === "ready" && state !== "uploading") {
    return (
      <div data-testid="reel-file" data-status="ready" className="space-y-3 text-sm">
        <p>
          الملف الأصلي جاهز{current.width && current.height ? ` (${current.width}×${current.height})` : ""}. يظهر في وضع الريلز بمشغّل الموقع بدل YouTube.
        </p>
        <button
          type="button"
          data-testid="reel-file-remove"
          onClick={async () => {
            await removeReelFile(current.id);
          }}
          className="min-h-11 rounded-sm border border-cream-line px-4"
        >
          حذف الملف (يبقى رابط YouTube)
        </button>
      </div>
    );
  }
  return (
    <div data-testid="reel-file" data-status={state} className="space-y-3 text-sm">
      <p className="text-on-cream-muted">ملف MP4 أو MOV حتى 500 ميغابايت، يفضّل عمودي. يُرفع مباشرة إلى التخزين، ويمكن متابعته بعد انقطاع باختيار الملف نفسه.</p>
      <input
        type="file"
        accept="video/mp4,video/quicktime"
        data-testid="reel-file-input"
        disabled={state === "uploading"}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) void start(f);
        }}
      />
      {state === "uploading" ? (
        <div className="flex items-center gap-3">
          <progress max={total || 1} value={sent} className="w-full" aria-label="تقدم الرفع" />
          <button type="button" onClick={() => stop.current?.abort()} className="min-h-11 rounded-sm border border-cream-line px-3">
            إيقاف
          </button>
        </div>
      ) : null}
      {state === "done" ? <p role="status">اكتمل الرفع. حدّث الصفحة لرؤية الحالة.</p> : null}
      {message ? <p role="alert" className="text-danger">{message}</p> : null}
    </div>
  );
}
