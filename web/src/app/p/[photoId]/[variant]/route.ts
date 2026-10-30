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
 *   4. streams the bytes.
 *
 * Cache (owner requirement: a withdrawn photo must stop loading): `private, no-cache` + the object's ETag. The
 * browser may keep a copy but must ask again before reusing it, and every ask runs steps 1–3, so after
 * unpublishing, the next request or page reload gets 404 (no 5-minute window). An unchanged photo costs a 304
 * without the bytes. Shared/CDN caches never store it. A picture already on a visitor's screen, or a copy they
 * saved, cannot be taken back — no cache policy can do that.
 *
 * Failures are told apart, all `no-store` so nothing wrong is ever cached:
 *   404 not published / not found (also a missing object)   503 database or storage error   504 timed out.
 * One deadline (DEADLINE_MS) covers the database checks and storage's response headers; streaming the bytes
 * after that is not cut off.
 */
const CACHE_OK = "private, no-cache";
const DEADLINE_MS = 8000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "album-media";

function fail(status: 404 | 503 | 504): Response {
  const body = status === 404 ? "Not found" : status === 504 ? "Timed out" : "Temporarily unavailable";
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      ...(status === 404 ? {} : { "Retry-After": "5" }),
    },
  });
}

const isAbort = (e: unknown) => e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
/** Supabase query errors carry the abort as a message/code rather than throwing. */
const abortedError = (e: { message?: string; code?: string } | null, signal: AbortSignal) =>
  signal.aborted || /abort/i.test(e?.message ?? "") || e?.code === "20";

export async function GET(req: Request, ctx: { params: Promise<{ photoId: string; variant: string }> }): Promise<Response> {
  const { photoId, variant } = await ctx.params;
  if (!UUID.test(photoId) || !(PHOTO_VARIANTS as readonly string[]).includes(variant)) return fail(404);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const anon = getPublicClient();
  if (!anon || !url || !anonKey) return fail(503);

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), DEADLINE_MS);
  try {
    // 1. Authorization: RLS proves publication.
    const { data: visible, error } = await anon.from("album_photos").select("id").eq("id", photoId).abortSignal(deadline.signal).maybeSingle();
    if (error) return fail(abortedError(error, deadline.signal) ? 504 : 503);
    if (!visible) return fail(404);

    // 2. Path for the authorized id + whitelisted variant (RPC re-checks publication).
    const { data: path, error: pathError } = await anon
      .rpc("album_photo_object_path", { p_photo_id: visible.id, p_variant: variant })
      .abortSignal(deadline.signal);
    if (pathError) return fail(abortedError(pathError, deadline.signal) ? 504 : 503);
    if (typeof path !== "string" || !path || path.includes("..") || path.startsWith("/")) return fail(404);

    // 3. Bytes with the anonymous key (storage policy re-checks). A conditional request lets storage answer 304.
    const objectUrl = `${url.replace(/\/$/, "")}/storage/v1/object/authenticated/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const inm = req.headers.get("if-none-match");
    let upstream: Response;
    try {
      upstream = await fetch(objectUrl, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, ...(inm ? { "If-None-Match": inm } : {}) },
        cache: "no-store",
        signal: deadline.signal,
      });
    } catch (e) {
      return fail(isAbort(e) || deadline.signal.aborted ? 504 : 503);
    }
    clearTimeout(timer); // headers arrived: the stream itself is not cut off

    const headers = new Headers({
      "Cache-Control": CACHE_OK,
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (upstream.status === 304) {
      void upstream.body?.cancel().catch(() => {});
      const etag = upstream.headers.get("etag");
      if (etag) headers.set("etag", etag);
      return new Response(null, { status: 304, headers });
    }
    if (!upstream.ok || !upstream.body) {
      // Never await the cancel: an error body must not hold the response open.
      void upstream.body?.cancel().catch(() => {});
      // Storage answers a missing / not-allowed object with 400/403/404 → not found. 5xx and the rest → unavailable.
      return fail([400, 403, 404].includes(upstream.status) ? 404 : 503);
    }
    for (const h of ["content-type", "content-length", "etag", "last-modified"]) {
      const val = upstream.headers.get(h);
      if (val) headers.set(h, val);
    }
    const ct = headers.get("content-type") ?? "";
    if (!/^image\/(jpeg|png|webp|avif)/.test(ct)) {
      void upstream.body.cancel().catch(() => {});
      return fail(404);
    }
    return new Response(upstream.body, { status: 200, headers });
  } catch (e) {
    return fail(isAbort(e) || deadline.signal.aborted ? 504 : 503);
  } finally {
    clearTimeout(timer);
  }
}
