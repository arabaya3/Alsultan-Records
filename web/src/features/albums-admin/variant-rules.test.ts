import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { VARIANTS } from "@/features/photo-processing/core";
import { CLIENT_VARIANT_MAX_BYTES, VARIANT_RECIPE, checkClientVariant, fitInside, validDimensions, variantPaths, webpSize } from "./variant-rules";

const webp = (w: number, h: number, lossless = false) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 60, b: 30 } } }).webp({ quality: 80, lossless }).toBuffer();

describe("variant recipe", () => {
  it("browser and server share one recipe", () => {
    expect(VARIANTS).toBe(VARIANT_RECIPE);
  });

  it("fits inside without enlarging, keeping the aspect ratio", () => {
    expect(fitInside(6000, 4000, 1600)).toEqual({ width: 1600, height: 1067 });
    expect(fitInside(3000, 4500, 480)).toEqual({ width: 320, height: 480 });
    expect(fitInside(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("variant paths sit next to the original", () => {
    expect(variantPaths("albums/a/p/original.jpg")).toEqual({ thumb: "albums/a/p/thumb.webp", display: "albums/a/p/display.webp" });
  });
});

describe("webpSize", () => {
  it("reads lossy (VP8) and lossless (VP8L) headers", async () => {
    expect(webpSize(new Uint8Array(await webp(1600, 1067)))).toEqual({ width: 1600, height: 1067 });
    expect(webpSize(new Uint8Array(await webp(321, 480, true)))).toEqual({ width: 321, height: 480 });
  });

  it("rejects non-WebP bytes", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer();
    expect(webpSize(new Uint8Array(png))).toBeNull();
    expect(webpSize(new Uint8Array(10))).toBeNull();
  });
});

describe("checkClientVariant", () => {
  const original = { width: 6000, height: 4000 };
  it("accepts a copy with the recipe's size (±1 px)", async () => {
    expect(checkClientVariant("display", new Uint8Array(await webp(1600, 1067)), original)).toBeNull();
    expect(checkClientVariant("display", new Uint8Array(await webp(1600, 1066)), original)).toBeNull();
    expect(checkClientVariant("thumb", new Uint8Array(await webp(480, 320)), original)).toBeNull();
  });

  it("refuses a wrong size, a non-WebP, a missing or an oversized copy", async () => {
    expect(checkClientVariant("display", new Uint8Array(await webp(1200, 800)), original)).toBe("unexpected size");
    expect(checkClientVariant("thumb", new Uint8Array(await webp(1600, 1067)), original)).toBe("unexpected size");
    const jpg = await sharp({ create: { width: 480, height: 320, channels: 3, background: "#000" } }).jpeg().toBuffer();
    expect(checkClientVariant("thumb", new Uint8Array(jpg), original)).toBe("not webp");
    expect(checkClientVariant("thumb", null, original)).toBe("missing");
    expect(checkClientVariant("thumb", new Uint8Array(CLIENT_VARIANT_MAX_BYTES.thumb + 1), original)).toBe("too large");
  });

  it("validates reported dimensions", () => {
    expect(validDimensions({ width: 6000, height: 4000 }, 150_000_000)).toBe(true);
    expect(validDimensions({ width: 0, height: 4000 }, 150_000_000)).toBe(false);
    expect(validDimensions({ width: 1.5, height: 2 }, 150_000_000)).toBe(false);
    expect(validDimensions({ width: 20000, height: 20000 }, 150_000_000)).toBe(false);
    expect(validDimensions(null, 150_000_000)).toBe(false);
  });
});
