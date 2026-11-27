import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicClient } from "@/features/public-content/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { s3SignedGet } from "@/lib/album-storage/s3";

/**
 * GET /r/{videoId} — the original reel file of a PUBLISHED video. The database is asked on every request
 * (public.reel_file_ref, anonymous), then the browser is sent to a short-lived signed link, so the bytes come straight
 * from the store and never pass through this function. Nothing is cached here: an unpublished video gets 404 from the next
 * request on; a link already handed out keeps working until it expires (LINK_SECONDS, long enough to start and seek).
 * Launch gate: while REELS_VIEWER is not "1" the route answers 404, so the reel files cannot be fetched (or cost
 * storage transfer) before the owner opens the viewer, even by someone who calls the public reel_files RPC.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_SECONDS = 10 * 60;
const NO_STORE = { "Cache-Control": "no-store", "CDN-Cache-Control": "no-store" };

export async function GET(_req: Request, ctx: { params: Promise<{ videoId: string }> }): Promise<Response> {
  if (process.env.REELS_VIEWER !== "1") return new Response("Not found", { status: 404, headers: NO_STORE });
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
