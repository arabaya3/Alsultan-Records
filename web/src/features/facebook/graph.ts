/**
 * Minimal Meta Graph client for Page reels (docs: developers.facebook.com/docs/video-api/guides/reels-publishing,
 * read 2026-10-28: v26.0; permissions pages_show_list, pages_read_engagement, pages_manage_posts; a Page token of a
 * user with CREATE_CONTENT on the Page; flow = start → upload (rupload, hosted file_url) → finish).
 *
 * Server only. The token is passed per call and never logged, returned or put in an error message.
 */
export const GRAPH_VERSION = "v26.0";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
  ) {
    super(message);
  }
  /** Token expired / revoked / permission removed → the connection must be renewed by the owner. */
  get authLost() {
    return this.code === 190 || this.code === 102 || this.code === 10 || (this.code !== null && this.code >= 200 && this.code < 300);
  }
  /** Worth retrying later: Meta-side or rate limiting. */
  get transient() {
    return this.status >= 500 || this.status === 429 || [1, 2, 4, 17, 32, 341, 368, 613].includes(this.code ?? -1);
  }
}

/** Per request (connect + body), well inside the worker's maxDuration; a timeout is a transient 504. */
export const REQUEST_TIMEOUT_MS = 10_000;

async function callWithin<T>(f: Fetch, url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  let raw: unknown;
  try {
    res = await f(url, { ...init, signal: ctl.signal });
    raw = await Promise.race([
      res.json().catch(() => ({})),
      new Promise((_, no) => ctl.signal.addEventListener("abort", () => no(new Error("abort")), { once: true })),
    ]);
  } catch {
    throw ctl.signal.aborted ? new GraphError("timeout", 504, null, null) : new GraphError("network error", 503, null, null);
  } finally {
    clearTimeout(timer);
  }
  const body = raw as { error?: { message?: string; code?: number; error_subcode?: number } } & T;
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    // Meta's message can echo request details; keep only a short, token-free summary.
    const msg = String(e.message ?? `HTTP ${res.status}`).replace(/access_token=[^&\s]+/g, "access_token=…").slice(0, 300);
    throw new GraphError(msg, res.status, e.code ?? null, e.error_subcode ?? null);
  }
  return body;
}

const form = (o: Record<string, string>) => new URLSearchParams(o);

export type ReelStatus = {
  video_status?: string;
  uploading_phase?: { status?: string };
  processing_phase?: { status?: string };
  publishing_phase?: { status?: string };
};

export function graphClient(f: Fetch, token: string, version = GRAPH_VERSION, timeoutMs = REQUEST_TIMEOUT_MS) {
  const g = `https://graph.facebook.com/${version}`;
  const call = <T,>(f: Fetch, url: string, init: RequestInit) => callWithin<T>(f, url, init, timeoutMs);
  return {
    start: (pageId: string) =>
      call<{ video_id: string; upload_url?: string }>(f, `${g}/${pageId}/video_reels`, {
        method: "POST",
        body: form({ upload_phase: "start", access_token: token }),
      }),
    /** Meta fetches the file itself from a short-lived signed URL: no video bytes pass through our function. */
    uploadHosted: (videoId: string, fileUrl: string) =>
      call<{ success: boolean }>(f, `https://rupload.facebook.com/video-upload/${version}/${videoId}`, {
        method: "POST",
        headers: { Authorization: `OAuth ${token}`, file_url: fileUrl },
      }),
    finish: (pageId: string, videoId: string, description: string | null) =>
      call<{ success: boolean; post_id?: string }>(f, `${g}/${pageId}/video_reels`, {
        method: "POST",
        body: form({ upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", ...(description ? { description } : {}), access_token: token }),
      }),
    status: (videoId: string) =>
      call<{ status?: ReelStatus }>(f, `${g}/${videoId}?fields=status&access_token=${encodeURIComponent(token)}`, { method: "GET" }),
  };
}

export const phaseDone = (p?: { status?: string }) => p?.status === "complete" || p?.status === "completed";
/** Meta says the reel will not be published (processing/publishing error, upload failed, expired). */
export const reelFailed = (s: ReelStatus) =>
  ["error", "upload_failed", "expired"].includes(s.video_status ?? "") ||
  s.processing_phase?.status === "error" ||
  s.publishing_phase?.status === "error";
