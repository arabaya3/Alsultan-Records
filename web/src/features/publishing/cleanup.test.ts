import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanupTargetError } from "./cleanup-guard";

const U = "0b6f2c1e-8d1a-4c3f-9e2b-7a5d4c3b2a10";

describe("storage cleanup target guard", () => {
  it("allows the media buckets", () => {
    expect(cleanupTargetError("private-media", `events/${U}/a.jpg`)).toBeNull();
    expect(cleanupTargetError("public-media", `events/${U}/a.jpg`)).toBeNull();
  });
  it("allows album-media only under albums/<uuid>/", () => {
    expect(cleanupTargetError("album-media", `albums/${U}/display/a.webp`)).toBeNull();
    expect(cleanupTargetError("album-media", "albums/not-a-uuid/a.webp")).toBe("invalid path");
    expect(cleanupTargetError("album-media", `other/${U}/a.webp`)).toBe("invalid path");
  });
  it("allows site-media only for deleted brand logos brand/<uuid>/logo.<ext>", () => {
    for (const ext of ["png", "webp", "jpg", "jpeg"]) expect(cleanupTargetError("site-media", `brand/${U}/logo.${ext}`)).toBeNull();
    expect(cleanupTargetError("site-media", `brand/${U}/other.png`)).toBe("invalid path");
    expect(cleanupTargetError("site-media", `brand/${U}/logo.svg`)).toBe("invalid path");
    expect(cleanupTargetError("site-media", "brand/x/logo.png")).toBe("invalid path");
    expect(cleanupTargetError("site-media", `hero/${U}/logo.png`)).toBe("invalid path");
  });
  it("rejects other buckets and traversal", () => {
    expect(cleanupTargetError("backups", "x.dump")).toMatch(/invalid bucket/);
    expect(cleanupTargetError("private-media", "../secret")).toBe("invalid path");
    expect(cleanupTargetError("private-media", "/abs")).toBe("invalid path");
    expect(cleanupTargetError("private-media", "a\\b")).toBe("invalid path");
    expect(cleanupTargetError("private-media", "")).toBe("invalid path");
  });
  it("the edge function uses the same allow-list patterns (kept in sync)", () => {
    const app = readFileSync("src/features/publishing/cleanup-guard.ts", "utf8");
    const edge = readFileSync("supabase/functions/storage-cleanup/index.ts", "utf8");
    for (const name of ["ALBUM_PATH", "SITE_PATH", "SITE_BUCKET", "ALBUM_BUCKET", "BUCKETS"]) {
      const re = new RegExp(`const ${name} = (.+);`);
      expect(edge.match(re)?.[1], name).toBe(app.match(re)?.[1]);
    }
  });
});
