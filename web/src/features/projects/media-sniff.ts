/**
 * Content check for event-media uploads (projects/media-actions.ts): the browser declares a MIME type, and before
 * this nothing compared it with the stored bytes for video, PDF or ZIP (technical audit SEC-15). Each type in
 * media-rules.ts MIME_RULES is matched against its file signature in the first SNIFF_BYTES bytes. Unknown → false.
 */
export const SNIFF_BYTES = 32;

const ascii = (b: Uint8Array, at: number, s: string) => s.split("").every((c, i) => b[at + i] === c.charCodeAt(0));
const bytes = (b: Uint8Array, at: number, xs: number[]) => xs.every((x, i) => b[at + i] === x);
/** ISO base media (MP4/MOV/HEIF/AVIF): "ftyp" at offset 4, then the major brand. */
const ftypBrand = (b: Uint8Array) => (b.length >= 12 && ascii(b, 4, "ftyp") ? String.fromCharCode(...b.slice(8, 12)) : null);

export function matchesDeclaredType(mime: string, head: Uint8Array): boolean {
  const brand = ftypBrand(head);
  switch (mime) {
    case "image/jpeg":
      return bytes(head, 0, [0xff, 0xd8, 0xff]);
    case "image/png":
      return bytes(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP");
    case "image/avif":
      return brand === "avif" || brand === "avis";
    case "image/heic":
      return brand !== null && ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(brand);
    case "video/mp4":
      return brand !== null && !["qt  ", "avif", "avis", "heic", "heix", "mif1", "msf1"].includes(brand);
    case "video/quicktime":
      // QuickTime files start with ftyp "qt  ", or (older files) with a moov/mdat/wide/free atom.
      return brand === "qt  " || ["moov", "mdat", "wide", "free", "skip"].some((a) => head.length >= 8 && ascii(head, 4, a));
    case "video/webm":
      return bytes(head, 0, [0x1a, 0x45, 0xdf, 0xa3]);
    case "application/pdf":
      return ascii(head, 0, "%PDF-");
    case "application/zip":
      return bytes(head, 0, [0x50, 0x4b, 0x03, 0x04]) || bytes(head, 0, [0x50, 0x4b, 0x05, 0x06]);
    default:
      return false;
  }
}
