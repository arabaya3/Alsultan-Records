import { VARIANT_RECIPE, fitInside } from "./variant-rules";
import { ALBUM_MAX_PIXELS, type FormatId } from "./rules";

/**
 * Web copies made in the admin's browser (Vercel Hobby CPU budget: resizing on the server was the largest share of
 * function CPU). Same recipe as the server worker (photo-processing/core.ts): fit inside 480 / 1600 px, never
 * enlarged, EXIF orientation applied, WebP at the same quality. A canvas re-encode carries no EXIF/GPS/XMP, so
 * location data in the original never reaches the public — the same guarantee as the server path.
 *
 * Only formats every current browser decodes; RAW and TIFF (and any browser that cannot encode WebP, e.g. older
 * Safari) return null and keep the server worker as before. Any failure returns null: the upload is never blocked.
 */
export const CLIENT_VARIANT_FORMATS: readonly FormatId[] = ["jpeg", "png", "webp", "avif"];

export type ClientVariants = { thumb: Blob; display: Blob; width: number; height: number };

type Canvas = { getContext(id: "2d"): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null } & ({ convertToBlob?: (o: ImageEncodeOptions) => Promise<Blob> } | HTMLCanvasElement);

function canvas(w: number, h: number): Canvas | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h) as unknown as Canvas;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function encode(c: Canvas, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in c && typeof c.convertToBlob === "function") return c.convertToBlob({ type: "image/webp", quality }).catch(() => null);
  return new Promise((resolve) => (c as HTMLCanvasElement).toBlob((b) => resolve(b), "image/webp", quality));
}

export async function makeClientVariants(file: File, format: FormatId): Promise<ClientVariants | null> {
  if (!CLIENT_VARIANT_FORMATS.includes(format) || typeof createImageBitmap !== "function") return null;
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = bmp;
    if (!width || !height || width * height > ALBUM_MAX_PIXELS) return null;
    const out: Partial<Record<keyof typeof VARIANT_RECIPE, Blob>> = {};
    for (const k of ["thumb", "display"] as const) {
      const size = fitInside(width, height, VARIANT_RECIPE[k].size);
      const c = canvas(size.width, size.height);
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, size.width, size.height);
      const blob = await encode(c, VARIANT_RECIPE[k].quality / 100);
      // A browser without a WebP encoder silently returns PNG: leave those to the server.
      if (!blob || blob.type !== "image/webp" || !blob.size) return null;
      out[k] = blob;
    }
    return { thumb: out.thumb!, display: out.display!, width, height };
  } catch {
    return null;
  } finally {
    bmp?.close();
  }
}
