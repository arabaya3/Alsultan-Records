import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Vercel Hobby CPU budget: public data is cached for a day (date-bound offers until Hebron midnight) and refreshed by tags, not regenerated every minute. */
const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");

describe("public cache policy", () => {
  it.each(["features/public-content/queries.ts", "features/public-content/cms-queries.ts", "features/public-content/gallery-queries.ts"])(
    "%s caches for days, never minutes or hours",
    (p) => {
      const s = src(p);
      expect(s).not.toMatch(/cacheLife\("(seconds|minutes|hours)"\)/);
      expect(s).toMatch(/cacheLife\("days"\)/);
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
  it("days for a successful read, minutes for a failed one (one call each)", async () => {
    const { publicLife } = await import("./cache-life");
    cacheLife.mockClear();
    const ok = { status: "ok" as const, data: 1 };
    expect(publicLife(ok)).toBe(ok);
    expect(cacheLife).toHaveBeenLastCalledWith("days");
    publicLife({ status: "unavailable" as const });
    expect(cacheLife).toHaveBeenLastCalledWith("minutes");
    expect(cacheLife).toHaveBeenCalledTimes(2);
  });

  it("date-bound reads refresh just after the next Hebron midnight", async () => {
    const { publicLife } = await import("./cache-life");
    cacheLife.mockClear();
    publicLife({ status: "ok" as const, data: 1 }, true);
    const arg = cacheLife.mock.calls[0][0] as { revalidate: number; expire: number };
    expect(arg.revalidate).toBeGreaterThan(60);
    expect(arg.revalidate).toBeLessThanOrEqual(86400 + 60);
    expect(arg.expire).toBeGreaterThan(arg.revalidate);
  });

  it("counts the seconds to Hebron midnight", async () => {
    const { secondsUntilHebronMidnight } = await import("./cache-life");
    // 2026-11-15 21:30 UTC is 23:30 in Hebron (UTC+2 in winter).
    expect(secondsUntilHebronMidnight(new Date("2026-11-15T21:30:00Z"))).toBe(1800);
    // 2026-07-15 08:00 UTC is 11:00 in Hebron (UTC+3 in summer).
    expect(secondsUntilHebronMidnight(new Date("2026-07-15T08:00:00Z"))).toBe(13 * 3600);
  });

  it("offers and announcements use the Hebron-midnight lifetime", () => {
    const s = src("features/public-content/cms-queries.ts");
    expect(s.match(/\n    true,\n  \);/g)?.length).toBe(2);
    expect(s).toMatch(/getActiveAnnouncements[\s\S]*?untilHebronMidnight\(\)/);
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
