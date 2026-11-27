import "server-only";
import { getPublicClient } from "@/features/public-content/client";

/**
 * The owner's ACTIVE logo: GET /a/{brandAssetId}. Mirrors /p/{photo}/{variant}:
 *   1. the anon RPC public.active_logo_path(p_id) returns the storage path ONLY while that id is
 *      business_settings.active_logo_id (any other / rolled-back version → null → 404);
 *   2. bytes come from the private `site-media` bucket with the ANON key (storage policy
 *      "site-media read active logo" re-checks that the object is the active logo);
 *   3. only raster image types are streamed (no SVG: it could carry script).
 * Browser cache 5 min, then a conditional request (304 when unchanged); shared caches never store it, so a rollback
 * is visible within minutes.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "site-media";

function gone(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "CDN-Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ logoId: string }> }): Promise<Response> {
  const { logoId } = await ctx.params;
  if (!UUID.test(logoId)) return gone();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const anon = getPublicClient();
  if (!anon || !url || !anonKey) return gone();

  const { data: path, error } = await anon.rpc("active_logo_path", { p_id: logoId });
  if (error || typeof path !== "string" || !path || path.includes("..") || path.startsWith("/")) return gone();

  const objectUrl = `${url.replace(/\/$/, "")}/storage/v1/object/authenticated/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
  // Revalidation after the 5 min: the browser's ETag lets storage answer 304 without the bytes. Only reached for the
  // active logo (checked above); the copy being revalidated passed the raster-type check when it was first served.
  const inm = req.headers.get("if-none-match");
  const upstream = await fetch(objectUrl, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, ...(inm ? { "If-None-Match": inm } : {}) },
    cache: "no-store",
  });
  const cacheHeaders = {
    "Cache-Control": "private, max-age=300",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (upstream.status === 304) {
    void upstream.body?.cancel().catch(() => {});
    const headers = new Headers(cacheHeaders);
    const etag = upstream.headers.get("etag");
    if (etag) headers.set("etag", etag);
    return new Response(null, { status: 304, headers });
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    return gone();
  }
  const ct = upstream.headers.get("content-type") ?? "";
  if (!/^image\/(png|webp|jpeg|avif)/.test(ct)) {
    await upstream.body.cancel();
    return gone();
  }
  const headers = new Headers({ "Content-Type": ct, ...cacheHeaders });
  for (const h of ["content-length", "etag", "last-modified"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: 200, headers });
}
