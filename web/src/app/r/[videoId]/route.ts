import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicClient } from "@/features/public-content/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { s3SignedGet } from "@/lib/album-storage/s3";

/**
 * GET /r/{videoId} — the original reel file of a PUBLISHED video. The database is asked on every request
 * (public.reel_file_ref, anonymous), then the browser is sent to a short-lived signed link, so the bytes come straight
 * from the store and never pass through this function. Nothing is cached: an unpublished video stops at the next request.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_SECONDS = 60 * 60;
const NO_STORE = { "Cache-Control": "no-store", "CDN-Cache-Control": "no-store" };

export async function GET(_req: Request, ctx: { params: Promise<{ videoId: string }> }): Promise<Response> {
  const { videoId } = await ctx.params;
  if (!UUID.test(videoId)) return new Response("Not found", { status: 404, headers: NO_STORE });
  const anon = getPublicClient() as unknown as SupabaseClient | null;
  if (!anon) return new Response("Unavailable", { status: 503, headers: NO_STORE });
  const { data, error } = await anon.rpc("reel_file_ref", { p_video_id: videoId });
  if (error) return new Response("Unavailable", { status: 503, headers: NO_STORE });
  const ref = (data as { provider: string; path: string }[] | null)?.[0];
  if (!ref?.path || ref.path.includes("..")) return new Response("Not found", { status: 404, headers: NO_STORE });
  try {
    let url: string | null;
    if (ref.provider === "s3") url = await s3SignedGet(ref.path, LINK_SECONDS);
    else url = (await createAdminClient().storage.from("reel-media").createSignedUrl(ref.path, LINK_SECONDS)).data?.signedUrl ?? null;
    if (!url) return new Response("Unavailable", { status: 503, headers: NO_STORE });
    return new Response(null, { status: 302, headers: { Location: url, ...NO_STORE } });
  } catch {
    return new Response("Unavailable", { status: 503, headers: NO_STORE });
  }
}
