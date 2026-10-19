/** Storage-cleanup allow-list (pure; shared by the app worker and mirrored in supabase/functions/storage-cleanup). */
export const BUCKETS = new Set(["public-media", "private-media"]);
/** album-media is allowed ONLY for album photo objects: albums/<album uuid>/<file path>. The queue gets
 *  these rows solely from the album_photos AFTER DELETE trigger (photo delete / album purge), so they
 *  never point at a live photo. Keep in sync with supabase/functions/storage-cleanup/index.ts. */
export const ALBUM_BUCKET = "album-media";
export const ALBUM_PATH = /^albums\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/i;
// site-media only for deleted brand logos: brand/<asset uuid>/logo.<ext> (queued solely by the brand_assets AFTER
// DELETE trigger, 0017). Without this the worker dead-lettered every logo deletion and the files stayed in storage.
export const SITE_BUCKET = "site-media";
export const SITE_PATH = /^brand\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/logo\.(?:png|webp|jpe?g)$/i;

/** Bucket allow-list + path guard. Returns an error string, or null when the object may be removed. */
export function cleanupTargetError(bucket: string, path: string | null | undefined): string | null {
  if (!BUCKETS.has(bucket) && bucket !== ALBUM_BUCKET && bucket !== SITE_BUCKET) return `invalid bucket ${bucket}`;
  if (!path || path.includes("..") || path.startsWith("/") || path.includes("\\")) return "invalid path";
  if (bucket === ALBUM_BUCKET && !ALBUM_PATH.test(path)) return "invalid path";
  if (bucket === SITE_BUCKET && !SITE_PATH.test(path)) return "invalid path";
  return null;
}
