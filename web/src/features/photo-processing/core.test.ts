import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { makeVariants, secretMatches, sha256Hex, variantPaths, VARIANTS } from "./core";

describe("photo-processing core", () => {
  it("compares secrets in constant time and rejects weak/missing config", () => {
    expect(secretMatches("a".repeat(32), "a".repeat(32))).toBe(true);
    expect(secretMatches("b".repeat(32), "a".repeat(32))).toBe(false);
    expect(secretMatches("short", "short")).toBe(false);
    expect(secretMatches(null, "a".repeat(32))).toBe(false);
    expect(secretMatches("x".repeat(32), undefined)).toBe(false);
  });
  it("keeps the exact variant recipe", () => {
    expect(VARIANTS).toEqual({ thumb: { size: 480, quality: 76 }, display: { size: 1600, quality: 82 } });
    expect(variantPaths("albums/a/p/original.jpg")).toEqual({ thumb: "albums/a/p/thumb.webp", display: "albums/a/p/display.webp" });
  });
  it("makes fit-inside webp variants without enlarging", async () => {
    const src = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#c90" } }).jpeg().toBuffer();
    const v = await makeVariants(src);
    expect([v.width, v.height]).toEqual([2000, 1000]);
    const t = await sharp(v.thumb).metadata();
    const d = await sharp(v.display).metadata();
    expect([t.format, t.width, t.height]).toEqual(["webp", 480, 240]);
    expect([d.width, d.height]).toEqual([1600, 800]);
    expect(sha256Hex(src)).toMatch(/^[0-9a-f]{64}$/);
  });
});
