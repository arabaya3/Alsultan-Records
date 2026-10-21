import { afterEach, describe, expect, it, vi } from "vitest";
import { breadcrumbJsonLd, metaDescription, pageMetadata, youTubeVideoJsonLd } from "./seo";
import { siteUrl } from "./site";

afterEach(() => vi.unstubAllEnvs());

describe("siteUrl (single source for absolute URLs)", () => {
  it("uses NEXT_PUBLIC_SITE_URL's origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sultan-records.vercel.app/some/path");
    expect(siteUrl()).toBe("https://sultan-records.vercel.app");
  });
  it("falls back to the Vercel production domain, never a preview URL, before localhost", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "sultan-records.vercel.app");
    vi.stubEnv("VERCEL_URL", "sultan-records-abc123-team.vercel.app");
    expect(siteUrl()).toBe("https://sultan-records.vercel.app");
  });
});

describe("metaDescription", () => {
  it("flattens editor text (lists, line breaks) into one line", () => {
    expect(metaDescription("1. تصوير سهرة العريس\n- كاميرا صور\n- كاميرا فيديو", "x")).toBe("تصوير سهرة العريس كاميرا صور كاميرا فيديو");
  });
  it("cuts long text at a word boundary with an ellipsis, within the limit", () => {
    const d = metaDescription("كلمة ".repeat(80), "x");
    expect(d.length).toBeLessThanOrEqual(161);
    expect(d.endsWith("…")).toBe(true);
    expect(d).not.toMatch(/\s…$/);
  });
  it("uses the fallback for empty text", () => {
    expect(metaDescription("  \n ", "fallback")).toBe("fallback");
  });
});

describe("pageMetadata", () => {
  it("keeps a share image on every page (default: the studio logo) and a self canonical", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sultan-records.vercel.app");
    const m = pageMetadata({ title: "الباقات", description: "d", path: "/packages" });
    expect(m.alternates?.canonical).toBe("https://sultan-records.vercel.app/packages");
    expect(JSON.stringify(m.openGraph)).toContain("/brand/logo-main.webp");
    const withImage = pageMetadata({ title: "t", description: "d", path: "/x", image: "/p/abc/display" });
    expect(JSON.stringify(withImage.openGraph)).toContain("/p/abc/display");
    expect(JSON.stringify(withImage.openGraph)).not.toContain("logo-main");
  });
});

describe("structured data", () => {
  it("BreadcrumbList with absolute URLs on the canonical origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sultan-records.vercel.app");
    const b = breadcrumbJsonLd([{ name: "الرئيسية", path: "/" }, { name: "أعمالنا", path: "/work" }]) as { itemListElement: { position: number; item: string }[] };
    expect(b.itemListElement.map((i) => [i.position, i.item])).toEqual([
      [1, "https://sultan-records.vercel.app/"],
      [2, "https://sultan-records.vercel.app/work"],
    ]);
  });
  it("VideoObject only from stored fields — no upload date stored means no object (nothing invented)", () => {
    const base = { youtube_id: "abcdefghijk", title: "سهرة", description: null, duration_seconds: null };
    expect(youTubeVideoJsonLd({ ...base, published_at: null })).toBeNull();
    const v = youTubeVideoJsonLd({ ...base, published_at: "2026-08-01T10:00:00Z", duration_seconds: 545 }) as Record<string, unknown>;
    expect(v.uploadDate).toBe("2026-08-01T10:00:00Z");
    expect(v.duration).toBe("PT545S");
    expect(v.thumbnailUrl).toEqual(["https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"]);
    const noDuration = youTubeVideoJsonLd({ ...base, published_at: "2026-08-01" }) as Record<string, unknown>;
    expect(noDuration.duration).toBeUndefined();
  });
});
