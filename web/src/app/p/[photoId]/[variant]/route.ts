import "server-only";
import { getPublicClient } from "@/features/public-content/client";
import { PHOTO_VARIANTS } from "@/features/public-content/gallery-model";

/**
 * Published album photos: GET /p/{photoId}/{thumb|display}. The original is NEVER served.
 *
 * `album-media` is a private bucket. Every request:
 *   1. reads the album_photos row with the ANONYMOUS key — RLS returns it only while the photo AND its
 *      album are published. No row → 404. This is the authorization step.
 *   2. resolves the object path with the anon RPC public.album_photo_object_path(id, variant) (migration
 *      0015, SECURITY DEFINER): it returns the stored variant path only while photo + album are published.
 *      Paths are not anon-selectable columns, so no secret key is needed anywhere on this route. The
 *      variant is whitelisted to thumb|display BEFORE the call — "original" is never requested.
 *   3. downloads the object with the ANONYMOUS key — the storage policy re-checks publication in the database.
 *   4. streams the bytes: browser-private cache for 5 min, shared caches never store it.
 * Unpublishing takes effect on the next request (404 + no-store).
 */
const CACHE_OK = "private, max-age=300";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "album-media";

function gone(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "CDN-Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ photoId: string; variant: string }> }): Promise<Response> {
  const { photoId, variant } = await ctx.params;
  if (!UUID.test(photoId) || !(PHOTO_VARIANTS as readonly string[]).includes(variant)) return gone();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const anon = getPublicClient();
  if (!anon || !url || !anonKey) return gone();

  // 1. Authorization: RLS proves publication.
  const { data: visible, error } = await anon.from("album_photos").select("id").eq("id", photoId).maybeSingle();
  if (error || !visible) return gone();

  // 2. Path for the authorized id + whitelisted variant (RPC re-checks publication).
  const { data: path, error: pathError } = await anon.rpc("album_photo_object_path", { p_photo_id: visible.id, p_variant: variant });
  if (pathError) return gone();
  if (typeof path !== "string" || !path || path.includes("..") || path.startsWith("/")) return gone();

  // 3. Bytes with the anonymous key (storage policy re-checks).
  const objectUrl = `${url.replace(/\/$/, "")}/storage/v1/object/authenticated/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const upstream = await fetch(objectUrl, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }, cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    return gone();
  }
  const headers = new Headers({
    "Cache-Control": CACHE_OK,
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  for (const h of ["content-type", "content-length", "etag", "last-modified"]) {
    const val = upstream.headers.get(h);
    if (val) headers.set(h, val);
  }
  const ct = headers.get("content-type") ?? "";
  if (!/^image\/(jpeg|png|webp|avif)/.test(ct)) {
    await upstream.body.cancel();
    return gone();
  }
  return new Response(upstream.body, { status: 200, headers });
}
