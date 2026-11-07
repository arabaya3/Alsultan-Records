/**
 * Web-copy recipe and checks shared by the browser (client-variants.ts), the server action that accepts browser-made
 * copies (actions.ts → completeAlbumUpload) and the server worker (photo-processing/core.ts). Pure: no I/O.
 * Do not change the recipe casually: existing variants were produced with exactly these values.
 */
export const VARIANT_RECIPE = {
  thumb: { size: 480, quality: 76 },
  display: { size: 1600, quality: 82 },
} as const;
export type VariantKey = keyof typeof VARIANT_RECIPE;

/** Upper bounds for a browser-made copy (a 1600 px WebP at q82 is typically 150–600 KB). */
export const CLIENT_VARIANT_MAX_BYTES: Record<VariantKey, number> = { thumb: 1024 * 1024, display: 6 * 1024 * 1024 };

/** Fit inside a size×size box, never enlarged, aspect kept (sharp `fit: "inside", withoutEnlargement`). */
export function fitInside(width: number, height: number, size: number): { width: number; height: number } {
  if (width <= size && height <= size) return { width, height };
  const scale = size / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Pixel size from a WebP header (VP8, VP8L or VP8X), or null if the bytes are not a WebP image. */
export function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const ascii = (o: number, s: string) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b.length < 30 || !ascii(0, "RIFF") || !ascii(8, "WEBP")) return null;
  const u24 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  if (ascii(12, "VP8X")) return { width: 1 + u24(24), height: 1 + u24(27) };
  if (ascii(12, "VP8L")) {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (ascii(12, "VP8 ")) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  return null;
}

/**
 * Server check of a browser-made copy: a real WebP, within the byte limit, whose pixel size is what the recipe gives
 * for the original's reported size (±1 px for rounding differences between encoders). Returns an error or null.
 */
export function checkClientVariant(key: VariantKey, bytes: Uint8Array | null, original: { width: number; height: number }): string | null {
  if (!bytes || !bytes.length) return "missing";
  if (bytes.length > CLIENT_VARIANT_MAX_BYTES[key]) return "too large";
  const got = webpSize(bytes);
  if (!got) return "not webp";
  const want = fitInside(original.width, original.height, VARIANT_RECIPE[key].size);
  if (Math.abs(got.width - want.width) > 1 || Math.abs(got.height - want.height) > 1) return "unexpected size";
  return null;
}

/** Original dimensions as reported by the browser: positive integers within the album pixel limit. */
export function validDimensions(d: unknown, maxPixels: number): d is { width: number; height: number } {
  if (!d || typeof d !== "object") return false;
  const { width, height } = d as { width?: unknown; height?: unknown };
  return Number.isInteger(width) && Number.isInteger(height) && (width as number) > 0 && (height as number) > 0 && (width as number) * (height as number) <= maxPixels;
}

/** Where an original's web copies live (the paths complete_photo_job accepts). */
export function variantPaths(originalPath: string): { thumb: string; display: string } {
  const base = originalPath.slice(0, originalPath.lastIndexOf("/"));
  return { thumb: `${base}/thumb.webp`, display: `${base}/display.webp` };
}
