import { describe, expect, it } from "vitest";
import { matchesDeclaredType, SNIFF_BYTES } from "./media-sniff";

const b = (...xs: (number | string)[]) =>
  Uint8Array.from(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
const ftyp = (brand: string) => b(0, 0, 0, 0x20, "ftyp", brand, 0, 0, 0, 0);

describe("matchesDeclaredType (event media uploads)", () => {
  it("reads only the first bytes", () => expect(SNIFF_BYTES).toBeLessThanOrEqual(64));

  it("accepts each allowed type with its real signature", () => {
    expect(matchesDeclaredType("image/jpeg", b(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(matchesDeclaredType("image/png", b(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(matchesDeclaredType("image/webp", b("RIFF", 1, 2, 3, 4, "WEBP"))).toBe(true);
    expect(matchesDeclaredType("image/avif", ftyp("avif"))).toBe(true);
    expect(matchesDeclaredType("image/heic", ftyp("heic"))).toBe(true);
    expect(matchesDeclaredType("image/heic", ftyp("mif1"))).toBe(true);
    expect(matchesDeclaredType("video/mp4", ftyp("isom"))).toBe(true);
    expect(matchesDeclaredType("video/quicktime", ftyp("qt  "))).toBe(true);
    expect(matchesDeclaredType("video/webm", b(0x1a, 0x45, 0xdf, 0xa3))).toBe(true);
    expect(matchesDeclaredType("application/pdf", b("%PDF-1.7"))).toBe(true);
    expect(matchesDeclaredType("application/zip", b("PK", 3, 4))).toBe(true);
  });

  it("refuses a file whose bytes are not its declared type", () => {
    expect(matchesDeclaredType("image/jpeg", b("<html>"))).toBe(false);
    expect(matchesDeclaredType("application/pdf", b("PK", 3, 4))).toBe(false);
    expect(matchesDeclaredType("video/mp4", b("<svg"))).toBe(false);
    expect(matchesDeclaredType("image/png", b(0xff, 0xd8, 0xff))).toBe(false);
    expect(matchesDeclaredType("image/jpeg", new Uint8Array())).toBe(false);
  });

  it("refuses a type that is not on the allow-list", () => {
    expect(matchesDeclaredType("text/html", b("<html>"))).toBe(false);
    expect(matchesDeclaredType("image/svg+xml", b("<svg"))).toBe(false);
  });
});
