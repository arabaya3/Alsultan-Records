import { describe, expect, it } from "vitest";
import { readCategoryForm, readVideoForm, whatsappLinkUrl, youtubeChannelUrl } from "./schema";

function fd(over: Record<string, string> = {}) {
  const f = new FormData();
  const base = { youtube: "https://youtu.be/A7Bby0aFuz0", title: "حفل زفاف", sort_order: "3", is_published: "on", ...over };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

describe("readVideoForm", () => {
  it("accepts a YouTube URL and keeps only the ID", () => {
    const r = readVideoForm(fd());
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ youtube_id: "A7Bby0aFuz0", sort_order: 3, is_published: true, is_promo: false, description: null });
  });
  it("accepts a bare ID", () => {
    expect(readVideoForm(fd({ youtube: "A7Bby0aFuz0" })).data?.youtube_id).toBe("A7Bby0aFuz0");
  });
  it.each([
    '<iframe src="https://www.youtube.com/embed/A7Bby0aFuz0"></iframe>',
    "https://evil.example/watch?v=A7Bby0aFuz0",
    "javascript:alert(1)",
    "",
    "short",
  ])("rejects %s", (youtube) => {
    expect(readVideoForm(fd({ youtube })).success).toBe(false);
  });
  it("rejects bad title / category / sort", () => {
    expect(readVideoForm(fd({ title: "x" })).success).toBe(false);
    expect(readVideoForm(fd({ title: "x".repeat(201) })).success).toBe(false);
    expect(readVideoForm(fd({ title: "استقبال العريس أحمد | تعليلة 2026 | الجديدة |" })).success).toBe(true);
    expect(readVideoForm(fd({ sort_order: "1.5" })).success).toBe(false);
    expect(readVideoForm(fd({ description: "x".repeat(10_001) })).success).toBe(false); // 10,000 since 0024 (owner request)
    expect(readVideoForm(fd({ description: "x".repeat(10_000) })).success).toBe(true);
  });
});

describe("video categories in the form", () => {
  const A = "00000000-0000-4000-8000-0000000000c1";
  const B = "00000000-0000-4000-8000-0000000000c2";
  it("accepts ids and a primary among them", () => {
    const f = fd({ primary_category: B });
    f.append("category_ids", A);
    f.append("category_ids", B);
    f.set("needs_review", "on");
    const r = readVideoForm(f);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ category_ids: [A, B], primary_category: B, needs_review: true });
  });
  it("rejects a primary that is not selected, and non-uuid ids", () => {
    const f = fd({ primary_category: B });
    f.append("category_ids", A);
    expect(readVideoForm(f).success).toBe(false);
    const g = fd();
    g.append("category_ids", "1 or 1=1");
    expect(readVideoForm(g).success).toBe(false);
  });
});

describe("readCategoryForm", () => {
  const cf = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  it("validates slug and title", () => {
    expect(readCategoryForm(cf({ slug: "wedding", title: "أعراس", is_published: "on" })).data).toMatchObject({ slug: "wedding", is_published: true, sort_order: 100 });
    expect(readCategoryForm(cf({ slug: "Bad-Slug", title: "أعراس" })).success).toBe(false);
    expect(readCategoryForm(cf({ slug: "ok", title: "x" })).success).toBe(false);
  });
});

describe("settings link validators", () => {
  it("youtube_url", () => {
    expect(youtubeChannelUrl.safeParse("https://www.youtube.com/channel/UCpxtdVABBIOaNLne-0_dDmQ/videos").success).toBe(true);
    expect(youtubeChannelUrl.safeParse(null).success).toBe(true);
    expect(youtubeChannelUrl.safeParse("http://www.youtube.com/x").success).toBe(false);
    expect(youtubeChannelUrl.safeParse("https://youtube.com.evil.example/x").success).toBe(false);
  });
  it("whatsapp_url", () => {
    expect(whatsappLinkUrl.safeParse("https://wa.me/message/I4OXKEUV7DX6L1").success).toBe(true);
    expect(whatsappLinkUrl.safeParse("https://api.whatsapp.com/send?phone=970598677477").success).toBe(true);
    expect(whatsappLinkUrl.safeParse("https://wa.evil.example/x").success).toBe(false);
    expect(whatsappLinkUrl.safeParse("javascript:alert(1)").success).toBe(false);
  });
});
