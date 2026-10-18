import { createHash, timingSafeEqual } from "node:crypto";
import sharp from "sharp";

/** Variant recipe — identical to the original admin uploader and import scripts. Do not change casually:
 *  existing variants on staging were produced with exactly these values. */
export const VARIANTS = {
  thumb: { size: 480, quality: 76 },
  display: { size: 1600, quality: 82 },
} as const;

/** Per-run limits sized for a Vercel Hobby function (maxDuration 60 s). */
export const JOB_BATCH = 8;
export const JOB_MAX_ATTEMPTS = 5;
export const JOB_STALE_MINUTES = 10;
/** Stop claiming more work once this much of the run budget is used. */
export const JOB_TIME_BUDGET_MS = 45_000;

export function sha256Hex(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

export const SHA256_RE = /^[0-9a-f]{64}$/;

/** Constant-time comparison of a presented secret with the configured one (hash first → equal lengths). */
export function secretMatches(presented: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected || expected.length < 16 || typeof presented !== "string" || !presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export type Variants = { thumb: Buffer; display: Buffer; width: number | null; height: number | null };

/** Fit-inside resize (never cropped, never enlarged), EXIF-rotated; the original is never modified. */
export async function makeVariants(input: Buffer): Promise<Variants> {
  const img = sharp(input, { failOn: "error" }).rotate();
  const meta = await img.metadata();
  const [thumb, display] = await Promise.all(
    (["thumb", "display"] as const).map((k) =>
      img
        .clone()
        .resize({ width: VARIANTS[k].size, height: VARIANTS[k].size, fit: "inside", withoutEnlargement: true })
        .webp({ quality: VARIANTS[k].quality })
        .toBuffer(),
    ),
  );
  const oriented = (meta.orientation ?? 1) >= 5;
  return {
    thumb,
    display,
    width: (oriented ? meta.height : meta.width) ?? null,
    height: (oriented ? meta.width : meta.height) ?? null,
  };
}

export function variantPaths(originalPath: string): { thumb: string; display: string } {
  const base = originalPath.slice(0, originalPath.lastIndexOf("/"));
  return { thumb: `${base}/thumb.webp`, display: `${base}/display.webp` };
}
