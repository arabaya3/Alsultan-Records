import { describe, expect, it } from "vitest";
import { readAlbumForm } from "./schema";
import { albumObjectPath, checkAlbumFile } from "./rules";

function fd(over: Record<string, string> = {}) {
  const f = new FormData();
  const base = { title: "عرس آل فلان", slug: "wedding-2026-07", source_label: "فيسبوك — ستوديو السلطان", source_url: "https://www.facebook.com/Sultan.Rec0rds2/photos", ...over };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

describe("readAlbumForm", () => {
  it("accepts a valid album and nulls empty optionals", () => {
    const r = readAlbumForm(fd({ event_date: "2026-07-13" }));
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ slug: "wedding-2026-07", event_date: "2026-07-13", description: null, rights_note: null, sort_order: 100 });
  });
  it.each([
    ["slug", "Bad Slug"],
    ["slug", "-x"],
    ["title", "x"],
    ["source_url", "http://facebook.com/x"],
    ["source_url", "javascript:alert(1)"],
    ["event_date", "13/07/2026"],
  ])("rejects %s=%s", (k, v) => {
    expect(readAlbumForm(fd({ [k]: v })).success).toBe(false);
  });
});

describe("album upload rules", () => {
  it("validates type and size", () => {
    expect(checkAlbumFile({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(checkAlbumFile({ type: "image/gif", size: 1000 })).not.toBeNull();
    expect(checkAlbumFile({ type: "image/heic", size: 1000 })).not.toBeNull();
    expect(checkAlbumFile({ type: "image/png", size: 0 })).not.toBeNull();
    expect(checkAlbumFile({ type: "image/png", size: 25 * 1024 ** 2 + 1 })).toBeNull(); // the old 25 MB wall is gone (0025)
    expect(checkAlbumFile({ type: "image/png", size: 50 * 1024 ** 2 + 1 })).not.toBeNull(); // project cap 50 MB
    expect(checkAlbumFile({ type: "image/x-canon-cr3", size: 30 * 1024 ** 2 })).toBeNull();
  });
  it("builds the storage path convention", () => {
    expect(albumObjectPath("a", "p", "image/webp")).toBe("albums/a/p/original.webp");
  });
});

describe("category form + album category", () => {
  it("accepts a category and an optional album category id", async () => {
    const { readCategoryForm } = await import("./schema");
    const f = new FormData();
    f.set("title", "أعراس");
    f.set("slug", "weddings");
    f.set("is_published", "on");
    expect(readCategoryForm(f).data).toMatchObject({ slug: "weddings", is_published: true, sort_order: 100 });
    f.set("slug", "Bad");
    expect(readCategoryForm(f).success).toBe(false);
    expect(readAlbumForm(fd({ category_id: "not-a-uuid" })).success).toBe(false);
    expect(readAlbumForm(fd({ category_id: "" })).data?.category_id).toBeNull();
  });
  it("computes sha256 like the server", async () => {
    const { fileSha256 } = await import("./rules");
    const { sha256Hex } = await import("@/features/photo-processing/core");
    const bytes = new TextEncoder().encode("sultan");
    expect(await fileSha256(new Blob([bytes]))).toBe(sha256Hex(bytes));
  });
});
