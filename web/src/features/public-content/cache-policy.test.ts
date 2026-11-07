import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Vercel Hobby CPU budget: public data is cached for hours and refreshed by tags, not regenerated every minute. */
const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");

describe("public cache policy", () => {
  it.each(["features/public-content/queries.ts", "features/public-content/cms-queries.ts", "features/public-content/gallery-queries.ts"])(
    "%s caches for hours, never minutes",
    (p) => {
      const s = src(p);
      expect(s).not.toMatch(/cacheLife\("(seconds|minutes)"\)/);
      expect(s).toMatch(/cacheLife\("hours"\)/);
    },
  );

  it("the cached /work body inherits the reads' lifetime (no explicit cacheLife overriding a failed read)", () => {
    expect(src("app/(public)/work/page.tsx")).not.toMatch(/cacheLife\(/);
  });

  it("review moderation expires the reviews tag", () => {
    expect(src("features/reviews/actions.ts")).toMatch(/updateTag\(TAGS\.reviews\)/);
  });
});

const revalidateTag = vi.hoisted(() => vi.fn());
const cacheLife = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag, cacheLife }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

describe("publicLife", () => {
  it("hours for a successful read, minutes for a failed one (one call each)", async () => {
    const { publicLife } = await import("./cache-life");
    const ok = { status: "ok" as const, data: 1 };
    expect(publicLife(ok)).toBe(ok);
    expect(cacheLife).toHaveBeenLastCalledWith("hours");
    publicLife({ status: "unavailable" as const });
    expect(cacheLife).toHaveBeenLastCalledWith("minutes");
    expect(cacheLife).toHaveBeenCalledTimes(2);
  });
});

describe("photo worker", () => {
  it("expires the public albums cache (stale-while-revalidate) and never throws over it", async () => {
    const { expirePublicAlbums } = await import("@/features/photo-processing/runner");
    expirePublicAlbums();
    expect(revalidateTag).toHaveBeenCalledWith("photo-albums", "max");
    revalidateTag.mockImplementationOnce(() => {
      throw new Error("outside request scope");
    });
    expect(() => expirePublicAlbums()).not.toThrow();
  });
});
