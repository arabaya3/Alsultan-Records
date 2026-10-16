import { describe, expect, it } from "vitest";
import { readVideoForm, whatsappLinkUrl, youtubeChannelUrl } from "./schema";

function fd(over: Record<string, string> = {}) {
  const f = new FormData();
  const base = { youtube: "https://youtu.be/A7Bby0aFuz0", title: "حفل زفاف", category: "wedding", sort_order: "3", is_published: "on", ...over };
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
    expect(readVideoForm(fd({ title: "x".repeat(121) })).success).toBe(false);
    expect(readVideoForm(fd({ category: "cats" })).success).toBe(false);
    expect(readVideoForm(fd({ sort_order: "1.5" })).success).toBe(false);
    expect(readVideoForm(fd({ description: "x".repeat(501) })).success).toBe(false);
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
