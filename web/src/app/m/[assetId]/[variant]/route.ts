import { getPublicClient, MEDIA_VARIANTS, type MediaVariant } from "@/features/public-content/client";

/**
 * Published media: GET /m/{assetId}/{variant}.
 *
 * The `public-media` bucket is private (migration 0010). Every request:
 *   1. reads the media row with the anonymous publishable key: RLS (media_public_read) returns it
 *      only while visibility = public AND upload ready AND (site media OR event published with
 *      consent granted);
 *   2. reads the object with the same anonymous key: the storage policy "public-media read live"
 *      re-checks the same condition in the database;
 *   3. streams the bytes (Range supported for video).
 * A withdrawn/unpublished asset answers 404 + `Cache-Control: no-store` from the next request on.
 *
 * Exposure window after withdrawal: only a visitor's OWN browser may reuse a 200 it already holds, for at
 * most MAX_AGE seconds. Shared caches (Vercel CDN, proxies) never store these responses ("private" +
 * CDN-Cache-Control/Vercel-CDN-Cache-Control: no-store), so the next request anywhere reaches this route. next/image is not in the path
 * (media is rendered `unoptimized`); images.minimumCacheTTL is pinned to the same value.
 */
const MAX_AGE = 60;
const CACHE_OK = `private, max-age=${MAX_AGE}, stale-while-revalidate=0, stale-if-error=0`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gone(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ assetId: string; variant: string }> }): Promise<Response> {
  const range = request.headers.get("range");
  const { assetId, variant } = await ctx.params;
  if (!UUID.test(assetId) || !(MEDIA_VARIANTS as readonly string[]).includes(variant)) return gone();

  const sb = getPublicClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!sb || !url || !key) return gone();

  const { data: row, error } = await sb
    .from("media_assets")
    .select("bucket, path, variants")
    .eq("id", assetId)
    .eq("bucket", "public-media")
    .eq("visibility", "public")
    .eq("upload_status", "ready")
    .maybeSingle();
  if (error || !row) return gone();

  const v = (row.variants ?? {}) as Record<string, unknown>;
  const path = (variant as MediaVariant) === "original" ? row.path : v[variant];
  if (typeof path !== "string" || !path || path.includes("..")) return gone();

  const objectUrl = `${url.replace(/\/$/, "")}/storage/v1/object/authenticated/public-media/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const upstream = await fetch(objectUrl, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(range ? { Range: range } : {}) },
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    return gone();
  }

  const headers = new Headers({
    "Cache-Control": CACHE_OK,
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "Accept-Ranges": "bytes",
  });
  for (const h of ["content-type", "content-length", "content-range", "etag", "last-modified"]) {
    const val = upstream.headers.get(h);
    if (val) headers.set(h, val);
  }
  return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}
