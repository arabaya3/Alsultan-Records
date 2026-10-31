import { secretMatches } from "@/features/photo-processing/core";
import { runPhotoJobs } from "@/features/photo-processing/runner";
import { processS3Cleanup } from "@/features/publishing/cleanup";
import { createAdminClient } from "@/lib/supabase/admin";
import { s3Env } from "@/lib/album-storage/s3";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * POST /api/jobs/process-photos — album photo processing worker (called by pg_cron via pg_net every minute).
 * Auth: header `x-jobs-secret` must equal server env JOBS_SECRET (constant-time). No body, no parameters:
 * it only processes what claim_photo_jobs hands out (≤ 8 photos per run, fits a 60 s Hobby function).
 * Also removes queued S3 objects, which the storage-cleanup Edge Function leaves to the app.
 */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request): Promise<Response> {
  if (!secretMatches(req.headers.get("x-jobs-secret"), process.env.JOBS_SECRET)) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  try {
    // First: photo jobs can use up the function's time.
    if (s3Env()) await processS3Cleanup(createAdminClient() as unknown as SupabaseClient);
    const r = await runPhotoJobs();
    return Response.json({ ok: true, claimed: r.claimed, ready: r.ready, failed: r.failed, ms: r.ms }, { headers: NO_STORE });
  } catch {
    return Response.json({ ok: false, error: "worker error" }, { status: 500, headers: NO_STORE });
  }
}

export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST", ...NO_STORE } });
}
