/** Album photo upload rules shared by the browser (pre-check) and the server (authoritative check).
 *
 * Formats are identified by their FIRST BYTES (magic numbers), never by the extension or the browser's MIME alone.
 * The extension only disambiguates the TIFF-based RAW family (NEF/NRW/ARW/DNG/PEF/SRW share the TIFF header); the
 * processing worker then proves the format by actually decoding it (sharp for images, LibRaw for RAW).
 *
 * Size limits are configurable (NEXT_PUBLIC_ALBUM_*_MAX_MB) and always capped by the Supabase project's global
 * upload limit (NEXT_PUBLIC_ALBUM_PROJECT_MAX_MB, 50 MB on this project — see docs/album-upload-release.md).
 * The `album-media` bucket limit (migration 0025) must be ≥ the effective limits. */
export const ALBUM_BUCKET = "album-media";

export type FormatKind = "image" | "raw";
export type FormatId =
  | "jpeg" | "png" | "webp" | "avif" | "tiff"
  | "cr2" | "cr3" | "nef" | "nrw" | "arw" | "dng" | "raf" | "orf" | "rw2" | "pef" | "srw";

type FormatDef = { kind: FormatKind; label: string; exts: string[]; mime: string; ext: string };
export const FORMATS: Record<FormatId, FormatDef> = {
  jpeg: { kind: "image", label: "JPEG", exts: ["jpg", "jpeg"], mime: "image/jpeg", ext: "jpg" },
  png: { kind: "image", label: "PNG", exts: ["png"], mime: "image/png", ext: "png" },
  webp: { kind: "image", label: "WebP", exts: ["webp"], mime: "image/webp", ext: "webp" },
  avif: { kind: "image", label: "AVIF", exts: ["avif"], mime: "image/avif", ext: "avif" },
  tiff: { kind: "image", label: "TIFF", exts: ["tif", "tiff"], mime: "image/tiff", ext: "tif" },
  cr2: { kind: "raw", label: "Canon CR2", exts: ["cr2"], mime: "image/x-canon-cr2", ext: "cr2" },
  cr3: { kind: "raw", label: "Canon CR3", exts: ["cr3"], mime: "image/x-canon-cr3", ext: "cr3" },
  nef: { kind: "raw", label: "Nikon NEF", exts: ["nef"], mime: "image/x-nikon-nef", ext: "nef" },
  nrw: { kind: "raw", label: "Nikon NRW", exts: ["nrw"], mime: "image/x-nikon-nrw", ext: "nrw" },
  arw: { kind: "raw", label: "Sony ARW", exts: ["arw"], mime: "image/x-sony-arw", ext: "arw" },
  dng: { kind: "raw", label: "DNG", exts: ["dng"], mime: "image/x-adobe-dng", ext: "dng" },
  raf: { kind: "raw", label: "Fujifilm RAF", exts: ["raf"], mime: "image/x-fuji-raf", ext: "raf" },
  orf: { kind: "raw", label: "Olympus ORF", exts: ["orf"], mime: "image/x-olympus-orf", ext: "orf" },
  rw2: { kind: "raw", label: "Panasonic RW2", exts: ["rw2"], mime: "image/x-panasonic-rw2", ext: "rw2" },
  pef: { kind: "raw", label: "Pentax PEF", exts: ["pef"], mime: "image/x-pentax-pef", ext: "pef" },
  srw: { kind: "raw", label: "Samsung SRW", exts: ["srw"], mime: "image/x-samsung-srw", ext: "srw" },
};
export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[];
export const ALBUM_MIMES = FORMAT_IDS.map((f) => FORMATS[f].mime);
/** Older code paths keyed by MIME. */
export const ALBUM_MIME_EXT: Record<string, string> = Object.fromEntries(FORMAT_IDS.map((f) => [FORMATS[f].mime, FORMATS[f].ext]));
export const formatByMime = (mime: string): FormatId | null => FORMAT_IDS.find((f) => FORMATS[f].mime === mime) ?? null;
/** <input accept>: extensions (browsers do not know RAW MIME types). */
export const ALBUM_ACCEPT = FORMAT_IDS.flatMap((f) => FORMATS[f].exts.map((e) => `.${e}`)).join(",");

// ------------------------------------------------------------------ limits
const MB = 1024 * 1024;
const envMb = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** Supabase project-wide upload cap (Storage settings). 50 MB here; raising it needs a plan that allows it. */
export const ALBUM_PROJECT_MAX_BYTES = envMb(process.env.NEXT_PUBLIC_ALBUM_PROJECT_MAX_MB, 50) * MB;
export const ALBUM_IMAGE_MAX_BYTES = Math.min(envMb(process.env.NEXT_PUBLIC_ALBUM_IMAGE_MAX_MB, 50) * MB, ALBUM_PROJECT_MAX_BYTES);
export const ALBUM_RAW_MAX_BYTES = Math.min(envMb(process.env.NEXT_PUBLIC_ALBUM_RAW_MAX_MB, 50) * MB, ALBUM_PROJECT_MAX_BYTES);
/** Largest file the worker will accept for any format (used where the format is not known yet). */
export const ALBUM_MAX_BYTES = Math.max(ALBUM_IMAGE_MAX_BYTES, ALBUM_RAW_MAX_BYTES);
export const maxBytesFor = (f: FormatId) => (FORMATS[f].kind === "raw" ? ALBUM_RAW_MAX_BYTES : ALBUM_IMAGE_MAX_BYTES);
/** Decoded pixel budget (memory/time of the worker): 150 MP covers medium-format cameras. */
export const ALBUM_MAX_PIXELS = 150_000_000;
/** Files per selection (the queue uploads a few at a time; this only bounds one pick). */
export const ALBUM_MAX_FILES_PER_BATCH = 300;
/** Parallel uploads per browser tab (env-tunable; 3 measured best — see the release report). */
export const ALBUM_UPLOAD_CONCURRENCY = Math.max(1, Math.min(6, Math.round(envMb(process.env.NEXT_PUBLIC_ALBUM_UPLOAD_CONCURRENCY, 3))));

export const fmtMb = (bytes: number) => `${Math.round(bytes / MB)}MB`;

// ------------------------------------------------------------------ format detection
const ascii = (b: Uint8Array, at: number, s: string) => s.split("").every((c, i) => b[at + i] === c.charCodeAt(0));
const isTiff = (b: Uint8Array) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a);
/** TIFF-header RAW (the worker proves each by decoding). CR2 usually carries a «CR» marker at byte 8, but older
 *  Canon bodies (e.g. PowerShot S2 IS) do not, so a plain TIFF header with a .cr2 name is accepted as well. */
const TIFF_RAW: FormatId[] = ["cr2", "nef", "nrw", "arw", "dng", "pef", "srw"];

/** Real format from the first bytes (≥ 16 needed) + the extension (only to split the TIFF-based RAW family).
 *  Returns null when the content does not match any supported format, or contradicts the extension. */
export function sniffFormat(head: Uint8Array, fileName: string): FormatId | null {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const claimed = FORMAT_IDS.find((f) => FORMATS[f].exts.includes(ext)) ?? null;
  if (!claimed || head.length < 16) return null;
  let actual: FormatId | "tiff-family" | null = null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) actual = "jpeg";
  else if (ascii(head, 0, "\x89PNG\r\n\x1a\n")) actual = "png";
  else if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) actual = "webp";
  else if (ascii(head, 4, "ftyp") && (ascii(head, 8, "avif") || ascii(head, 8, "avis"))) actual = "avif";
  else if (ascii(head, 4, "ftyp") && ascii(head, 8, "crx ")) actual = "cr3";
  else if (ascii(head, 0, "FUJIFILMCCD-RAW")) actual = "raf";
  else if (ascii(head, 0, "IIRO") || ascii(head, 0, "IIRS") || ascii(head, 0, "MMOR")) actual = "orf";
  else if (head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x55 && head[3] === 0x00) actual = "rw2";
  else if (isTiff(head)) actual = head[8] === 0x43 && head[9] === 0x52 ? "cr2" : "tiff-family";
  // A «CR» marker is Canon-only: it must be named .cr2.
  if (!actual) return null;
  if (actual === "tiff-family") return claimed === "tiff" || TIFF_RAW.includes(claimed) ? claimed : null;
  return actual === claimed ? actual : null;
}

/** Browser pre-check (size by kind + content sniff). The server repeats every check. */
export async function checkAlbumFileContent(f: File): Promise<{ format: FormatId } | { error: string }> {
  if (!(f.size > 0)) return { error: "الملف فارغ." };
  const head = new Uint8Array(await f.slice(0, 64).arrayBuffer());
  const format = sniffFormat(head, f.name);
  if (!format) return { error: "نوع الملف غير مدعوم، أو محتواه لا يطابق امتداده." };
  const max = maxBytesFor(format);
  if (f.size > max) return { error: `الملف أكبر من الحد (${fmtMb(max)} لملفات ${FORMATS[format].kind === "raw" ? "RAW" : "الصور"}).` };
  return { format };
}

/** Legacy shape check (MIME + size) kept for callers that only know the declared type. */
export function checkAlbumFile(f: { type: string; size: number }): string | null {
  const format = formatByMime(f.type);
  if (!format) return "نوع الملف غير مدعوم.";
  if (!(f.size > 0)) return "الملف فارغ.";
  if (f.size > maxBytesFor(format)) return `الصورة أكبر من ${fmtMb(maxBytesFor(format))}.`;
  return null;
}

export function albumObjectPath(albumId: string, photoId: string, mimeOrFormat: string): string {
  const format = (FORMATS as Record<string, FormatDef>)[mimeOrFormat] ? (mimeOrFormat as FormatId) : formatByMime(mimeOrFormat);
  if (!format) throw new Error("unsupported format");
  return `albums/${albumId}/${photoId}/original.${FORMATS[format].ext}`;
}

export const SHA256_RE = /^[0-9a-f]{64}$/;

/** sha256 of a file streamed in 4 MB slices (never the whole file in memory). Pure JS (@noble/hashes) on purpose:
 *  the site's CSP blocks WebAssembly in the browser, and should keep doing so. Browser + Node (Blob). */
export async function fileSha256(f: Blob, onProgress?: (bytes: number) => void): Promise<string> {
  const { sha256 } = await import("@noble/hashes/sha2");
  const h = sha256.create();
  const STEP = 4 * MB;
  for (let at = 0; at < f.size; at += STEP) {
    h.update(new Uint8Array(await f.slice(at, Math.min(at + STEP, f.size)).arrayBuffer()));
    onProgress?.(Math.min(at + STEP, f.size));
  }
  return Array.from(h.digest(), (b) => b.toString(16).padStart(2, "0")).join("");
}
