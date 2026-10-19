/** Upload rules shared by the browser (pre-check) and the server (authoritative check). */
export type MediaKind = "image" | "video" | "document";

export const MIME_RULES: Record<string, { kind: MediaKind; ext: string; max: number }> = {
  "image/jpeg": { kind: "image", ext: "jpg", max: 50 * 1024 ** 2 },
  "image/png": { kind: "image", ext: "png", max: 50 * 1024 ** 2 },
  "image/webp": { kind: "image", ext: "webp", max: 50 * 1024 ** 2 },
  "image/avif": { kind: "image", ext: "avif", max: 50 * 1024 ** 2 },
  "image/heic": { kind: "image", ext: "heic", max: 50 * 1024 ** 2 },
  "video/mp4": { kind: "video", ext: "mp4", max: 2 * 1024 ** 3 },
  "video/quicktime": { kind: "video", ext: "mov", max: 2 * 1024 ** 3 },
  "video/webm": { kind: "video", ext: "webm", max: 2 * 1024 ** 3 },
  "application/pdf": { kind: "document", ext: "pdf", max: 200 * 1024 ** 2 },
  "application/zip": { kind: "document", ext: "zip", max: 2 * 1024 ** 3 },
};

export const MAX_FILES_PER_BATCH = 50;
export const ACCEPT = Object.keys(MIME_RULES).join(",");

export function checkFile(f: { type: string; size: number }): string | null {
  const rule = MIME_RULES[f.type];
  if (!rule) return "نوع الملف غير مدعوم.";
  if (f.size <= 0) return "الملف فارغ.";
  if (f.size > rule.max) return `الملف أكبر من الحد المسموح (${Math.round(rule.max / 1024 ** 2)} MB).`;
  return null;
}
