import { secretMatches } from "@/features/photo-processing/core";
import { runFacebookJobs } from "@/features/facebook/runner";

/**
 * POST /api/jobs/facebook-reels — "also post to Facebook" worker (pg_cron → pg_net every minute, migration 0027).
 * Auth: header `x-jobs-secret` = JOBS_SECRET. Does nothing unless a Page is connected and a job is due.
 */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request): Promise<Response> {
  if (!secretMatches(req.headers.get("x-jobs-secret"), process.env.JOBS_SECRET)) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  try {
    return Response.json({ ok: true, ...(await runFacebookJobs()) }, { headers: NO_STORE });
  } catch {
    return Response.json({ ok: false, error: "worker error" }, { status: 500, headers: NO_STORE });
  }
}

export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST", ...NO_STORE } });
}
