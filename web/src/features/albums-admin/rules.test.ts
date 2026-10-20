import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALBUM_IMAGE_MAX_BYTES, ALBUM_PROJECT_MAX_BYTES, ALBUM_RAW_MAX_BYTES, albumObjectPath, fileSha256, sniffFormat } from "./rules";
import { createHash } from "node:crypto";

const head = (...bytes: (number | string)[]) => {
  const out: number[] = [];
  for (const b of bytes) {
    if (typeof b === "number") out.push(b);
    else out.push(...b.split("").map((c) => c.charCodeAt(0)));
  }
  while (out.length < 64) out.push(0);
  return new Uint8Array(out);
};
const SAMPLES = path.resolve(__dirname, "../../../.cache/raw-samples");

describe("sniffFormat (content, not extension)", () => {
  it("recognises image formats by magic bytes", () => {
    expect(sniffFormat(head(0xff, 0xd8, 0xff, 0xe0), "a.JPG")).toBe("jpeg");
    expect(sniffFormat(head(0x89, "PNG\r\n\x1a\n"), "a.png")).toBe("png");
    expect(sniffFormat(head("RIFF", 0, 0, 0, 0, "WEBP"), "a.webp")).toBe("webp");
    expect(sniffFormat(head(0, 0, 0, 0x1c, "ftypavif"), "a.avif")).toBe("avif");
    expect(sniffFormat(head("II*", 0), "scan.tiff")).toBe("tiff");
  });
  it("recognises RAW families", () => {
    expect(sniffFormat(head("II*", 0, 8, 0, 0, 0, "CR"), "x.CR2")).toBe("cr2");
    expect(sniffFormat(head(0, 0, 0, 0x18, "ftypcrx "), "x.cr3")).toBe("cr3");
    expect(sniffFormat(head("FUJIFILMCCD-RAW 0201"), "x.RAF")).toBe("raf");
    expect(sniffFormat(head("IIRS"), "x.orf")).toBe("orf");
    expect(sniffFormat(head("IIU", 0), "x.rw2")).toBe("rw2");
    for (const ext of ["nef", "nrw", "arw", "dng", "pef", "srw"]) expect(sniffFormat(head("MM", 0, "*"), `x.${ext}`)).toBe(ext);
  });
  it("rejects forged extensions and unknown content", () => {
    expect(sniffFormat(head("%PDF-1.7"), "photo.jpg")).toBeNull(); // PDF renamed .jpg
    expect(sniffFormat(head(0xff, 0xd8, 0xff, 0xe0), "photo.cr2")).toBeNull(); // JPEG renamed .cr2
    expect(sniffFormat(head(0xff, 0xd8, 0xff, 0xe0), "photo.png")).toBeNull();
    expect(sniffFormat(head("II*", 0), "x.jpg")).toBeNull(); // TIFF renamed .jpg
    expect(sniffFormat(head(0xff, 0xd8, 0xff), "photo.heic")).toBeNull(); // unsupported extension
    expect(sniffFormat(head(0xff, 0xd8, 0xff), "noext")).toBeNull();
  });
  it.runIf(fs.existsSync(SAMPLES))("recognises the real CC0 RAW samples (raw.pixls.us)", () => {
    for (const f of fs.readdirSync(SAMPLES)) {
      const b = fs.readFileSync(path.join(SAMPLES, f)).subarray(0, 64);
      expect(sniffFormat(new Uint8Array(b), f), f).toBe(f.split(".").pop()!.toLowerCase());
    }
  });
});

describe("limits and paths", () => {
  it("never exceed the project cap", () => {
    expect(ALBUM_IMAGE_MAX_BYTES).toBeLessThanOrEqual(ALBUM_PROJECT_MAX_BYTES);
    expect(ALBUM_RAW_MAX_BYTES).toBeLessThanOrEqual(ALBUM_PROJECT_MAX_BYTES);
    expect(ALBUM_IMAGE_MAX_BYTES).toBeGreaterThan(25 * 1024 * 1024); // the old 25 MB wall is gone
  });
  it("object path keeps the real format extension", () => {
    const a = "0b6f2c1e-8d1a-4c3f-9e2b-7a5d4c3b2a10";
    expect(albumObjectPath(a, a, "cr3")).toBe(`albums/${a}/${a}/original.cr3`);
    expect(albumObjectPath(a, a, "image/jpeg")).toBe(`albums/${a}/${a}/original.jpg`);
  });
  it("streams sha256 identical to a one-shot hash", async () => {
    const buf = Buffer.alloc(9 * 1024 * 1024 + 123, 7);
    expect(await fileSha256(new Blob([buf]))).toBe(createHash("sha256").update(buf).digest("hex"));
  });
});
