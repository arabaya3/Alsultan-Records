/** Album photo upload rules shared by the browser (pre-check) and the server (authoritative check).
 *  Mirrors the `album-media` bucket limits (migration 0015). */
export const ALBUM_BUCKET = "album-media";
export const ALBUM_MAX_BYTES = 25 * 1024 ** 2;
export const ALBUM_MAX_FILES_PER_BATCH = 100;
export const ALBUM_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};
export const ALBUM_ACCEPT = Object.keys(ALBUM_MIME_EXT).join(",");

export function checkAlbumFile(f: { type: string; size: number }): string | null {
  if (!ALBUM_MIME_EXT[f.type]) return "نوع الملف غير مدعوم (JPEG أو PNG أو WebP أو AVIF فقط).";
  if (!(f.size > 0)) return "الملف فارغ.";
  if (f.size > ALBUM_MAX_BYTES) return "الصورة أكبر من 25MB.";
  return null;
}

export function albumObjectPath(albumId: string, photoId: string, mime: string): string {
  return `albums/${albumId}/${photoId}/original.${ALBUM_MIME_EXT[mime]}`;
}

export const SHA256_RE = /^[0-9a-f]{64}$/;

/** sha256 of a file in the browser (SubtleCrypto) for the duplicate pre-check; the server re-verifies after upload. */
export async function fileSha256(f: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
