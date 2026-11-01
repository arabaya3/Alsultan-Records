import { describe, expect, it } from "vitest";
import { homeAlbums, latestAlbumHeroPhoto, newestPublishedFirst } from "./gallery-model";
import { formatDateAr } from "./labels";

type A = { id: string; event_date: string | null; created_at: string | null; published_at: string | null; listed_at: string | null; coverId: string | null };
const album = (id: string, o: Partial<A> = {}): A => {
  const a = { id, event_date: null, created_at: "2026-01-01T10:00:00+00:00", published_at: null, coverId: `${id}-cover`, ...o };
  return { listed_at: a.published_at ?? a.created_at, ...a };
};

describe("newestPublishedFirst (migration 0026 order)", () => {
  it("an occasion from last year published today comes first", () => {
    const old = album("a-old", { event_date: "2026-09-01", created_at: "2026-09-02T08:00:00Z", published_at: "2026-09-02T08:00:00Z" });
    const fresh = album("b-fresh", { event_date: "2025-10-20", created_at: "2026-10-28T09:00:00Z", published_at: "2026-10-28T09:05:00Z" });
    expect(newestPublishedFirst([old, fresh]).map((a) => a.id)).toEqual(["b-fresh", "a-old"]);
  });
  it("uses the publish time, not the creation time (a long-standing draft published today is newest)", () => {
    const draftThenPublished = album("x", { created_at: "2026-03-01T00:00:00Z", published_at: "2026-10-28T12:00:00Z" });
    const recent = album("y", { created_at: "2026-10-27T00:00:00Z", published_at: "2026-10-27T00:00:00Z" });
    expect(newestPublishedFirst([recent, draftThenPublished]).map((a) => a.id)).toEqual(["x", "y"]);
  });
  it("legacy albums (no recorded publish time) fall back to created_at — never to the event date or the title", () => {
    const legacyNew = album("legacy-new", { created_at: "2026-10-10T00:00:00Z", event_date: "2020-01-01" });
    const legacyOld = album("legacy-old", { created_at: "2026-05-10T00:00:00Z", event_date: "2026-10-01" });
    expect(newestPublishedFirst([legacyOld, legacyNew]).map((a) => a.id)).toEqual(["legacy-new", "legacy-old"]);
  });
  it("equal publish times break deterministically on id (desc), whatever the input order", () => {
    const t = "2026-10-28T09:00:00Z";
    const xs = ["0b", "0c", "0a"].map((id) => album(id, { published_at: t }));
    const want = ["0c", "0b", "0a"];
    expect(newestPublishedFirst(xs).map((a) => a.id)).toEqual(want);
    expect(newestPublishedFirst([...xs].reverse()).map((a) => a.id)).toEqual(want);
  });
  it("compares instants across offsets (+03:00 vs Z)", () => {
    const a = album("a", { published_at: "2026-10-28T11:30:00+03:00" }); // 08:30Z
    const b = album("b", { published_at: "2026-10-28T09:00:00Z" });
    expect(newestPublishedFirst([a, b]).map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("does not mutate its input", () => {
    const xs = [album("1", { published_at: "2026-01-01T00:00:00Z" }), album("2", { published_at: "2026-02-01T00:00:00Z" })];
    newestPublishedFirst(xs);
    expect(xs.map((a) => a.id)).toEqual(["1", "2"]);
  });
});

describe("latestAlbumHeroPhoto (hero source = newest album)", () => {
  it("returns the newest album's usable cover", () => {
    expect(
      latestAlbumHeroPhoto([album("old", { published_at: "2026-01-01T00:00:00Z" }), album("new", { published_at: "2026-10-28T00:00:00Z" })]),
    ).toBe("new-cover");
  });
  it("skips a newest album with no usable photo and takes the next one", () => {
    expect(
      latestAlbumHeroPhoto([
        album("empty", { published_at: "2026-10-28T00:00:00Z", coverId: null }),
        album("next", { published_at: "2026-10-01T00:00:00Z" }),
      ]),
    ).toBe("next-cover");
  });
  it("no eligible photo at all → null (designed hero without a photo)", () => {
    expect(latestAlbumHeroPhoto([])).toBeNull();
    expect(latestAlbumHeroPhoto([album("a", { coverId: null })])).toBeNull();
  });
});

describe("occasion date display (Asia/Hebron)", () => {
  it("a date-only value shows its own month, at month edges too", () => {
    expect(formatDateAr("2025-10-31")).toBe(new Intl.DateTimeFormat("ar-PS", { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date("2025-10-31")));
    expect(formatDateAr("2026-01-01")).toBe(new Intl.DateTimeFormat("ar-PS", { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date("2026-01-01")));
  });
  it("no date → nothing shown (never today's date)", () => {
    expect(formatDateAr(null)).toBeNull();
  });
});

describe("homeAlbums (strictly newest published first, picks not mixed in)", () => {
  const list = ["n1", "n2", "n3", "n4", "n5", "n6"].map((id) => ({ id })); // already newest-first
  it("the full chronological order, capped at the limit", () => {
    expect(homeAlbums(list, 4).map((a) => a.id)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(homeAlbums(list, 12).map((a) => a.id)).toEqual(["n1", "n2", "n3", "n4", "n5", "n6"]);
  });
  it("empty list or zero limit → nothing; the input is not modified", () => {
    expect(homeAlbums([], 4)).toEqual([]);
    expect(homeAlbums(list, 0)).toEqual([]);
    expect(list.map((a) => a.id)).toEqual(["n1", "n2", "n3", "n4", "n5", "n6"]);
  });
});

describe("hero sources", () => {
  it("backdrops: one cover per album, newest published first, albums without a cover skipped", async () => {
    const { albumHeroPhotos } = await import("./gallery-model");
    const list = [album("old", { published_at: "2026-01-01T00:00:00Z" }), album("new", { published_at: "2026-03-01T00:00:00Z" }), album("none", { published_at: "2026-04-01T00:00:00Z", coverId: null })];
    expect(albumHeroPhotos(list as never)).toEqual(["new-cover", "old-cover"]);
  });
  it("hero video: the newest non-promo by YouTube date", async () => {
    const { latestVideo } = await import("./gallery-model");
    const v = (id: string, published_at: string | null, role = "work") => ({ id, published_at, role, is_promo: role === "promo" });
    const g = { videos: [v("a", "2026-01-01"), v("b", "2026-09-01"), v("p", "2026-10-30", "promo"), v("c", null)], categories: [], promo: null };
    expect(latestVideo(g as never)?.id).toBe("b");
    expect(latestVideo({ ...g, videos: [v("p", "2026-10-30", "promo")] } as never)).toBeNull();
  });
});
