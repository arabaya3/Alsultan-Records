import { secretMatches } from "@/features/photo-processing/core";
import { runPhotoJobs } from "@/features/photo-processing/runner";

/**
 * POST /api/jobs/process-photos — album photo processing worker (called by pg_cron via pg_net every minute).
 * Auth: header `x-jobs-secret` must equal server env JOBS_SECRET (constant-time). No body, no parameters:
 * it only processes what claim_photo_jobs hands out (≤ 8 photos per run, fits a 60 s Hobby function).
 */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request): Promise<Response> {
  if (!secretMatches(req.headers.get("x-jobs-secret"), process.env.JOBS_SECRET)) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  try {
    const r = await runPhotoJobs();
    return Response.json({ ok: true, claimed: r.claimed, ready: r.ready, failed: r.failed, ms: r.ms }, { headers: NO_STORE });
  } catch {
    return Response.json({ ok: false, error: "worker error" }, { status: 500, headers: NO_STORE });
  }
}

export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST", ...NO_STORE } });
}
