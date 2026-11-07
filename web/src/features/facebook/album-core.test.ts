import { describe, expect, it } from "vitest";
import { runAlbumPost, type AlbumPatch, type AlbumPost } from "./album-core";
import type { AlbumGraph } from "./album-graph";
import { GraphError } from "./graph";

const base = (o: Partial<AlbumPost> = {}): AlbumPost => ({
  id: "row",
  status: "creating",
  page_id: "123",
  title: "ألبوم تجريبي",
  message: null,
  photo_ids: ["p1", "p2"],
  done: {},
  fb_album_id: null,
  fb_album_url: null,
  attempts: 0,
  ...o,
});

function fake(over: Partial<AlbumGraph> = {}) {
  const calls: string[] = [];
  let n = 0;
  const graph: AlbumGraph = {
    createAlbum: async (page, name) => (calls.push(`create:${page}:${name}`), { id: "A1" }),
    findAlbum: async (page, name) => (calls.push(`find:${page}:${name}`), null),
    albumLink: async (id) => (calls.push(`link:${id}`), `https://www.facebook.com/media/set/?set=a.${id}`),
    addPhoto: async (album, jpeg, file) => (calls.push(`photo:${album}:${file}`), { id: `F${++n}` }),
    ...over,
  };
  const saves: AlbumPatch[] = [];
  return { graph, calls, saves, save: async (p: AlbumPatch) => void saves.push(structuredClone(p)), photoJpeg: async () => Buffer.from([0xff, 0xd8]) };
}

describe("runAlbumPost", () => {
  it("creates ONE album, stores its id before any photo, adds each photo once, then the link", async () => {
    const f = fake();
    const r = await runAlbumPost(base(), f);
    expect(f.calls).toEqual(["create:123:ألبوم تجريبي", "photo:A1:p1.jpg", "photo:A1:p2.jpg", "link:A1"]);
    expect(r).toMatchObject({ status: "published", sent: 2, remaining: 0, url: "https://www.facebook.com/media/set/?set=a.A1" });
    const idSave = f.saves.findIndex((s) => s.fb_album_id === "A1");
    const firstPhotoSave = f.saves.findIndex((s) => s.done && Object.keys(s.done).length === 1);
    expect(idSave).toBeGreaterThan(-1);
    expect(idSave).toBeLessThan(firstPhotoSave); // the album id is durable before any photo is sent
    expect(f.saves[0]).toMatchObject({ attempts: 1, status: "creating" }); // "a create was sent" recorded first
  });

  it("never creates a second album: a retry after a lost create response adopts the album found by name", async () => {
    const f = fake({ findAlbum: async () => ({ id: "A9", name: "ألبوم تجريبي" }) });
    await runAlbumPost(base({ attempts: 1 }), f);
    expect(f.calls.filter((c) => c.startsWith("create"))).toEqual([]);
    expect(f.calls[0]).toBe("photo:A9:p1.jpg"); // straight into the adopted album
  });

  it("resuming sends only the photos not on Facebook yet, into the same album", async () => {
    const f = fake();
    const r = await runAlbumPost(base({ status: "uploading", fb_album_id: "A1", done: { p1: "F0" } }), f);
    expect(f.calls).toEqual(["photo:A1:p2.jpg", "link:A1"]);
    expect(r.status).toBe("published");
  });

  it("stops before the time limit and leaves the rest for «متابعة»", async () => {
    let t = 0;
    const f = fake({ addPhoto: async () => ((t += 30_000), { id: "F1" }) });
    const r = await runAlbumPost(base({ status: "uploading", fb_album_id: "A1" }), { ...f, clock: () => t, budgetMs: 50_000 });
    expect(r).toMatchObject({ status: "uploading", sent: 1, remaining: 1 });
  });

  it("a Meta error marks the run failed with a readable reason and keeps what was done", async () => {
    let i = 0;
    const f = fake({ addPhoto: async () => { if (++i === 2) throw new GraphError("bad", 400, 324, null); return { id: "F1" }; } });
    const r = await runAlbumPost(base({ status: "uploading", fb_album_id: "A1" }), f);
    expect(r).toMatchObject({ status: "failed", sent: 1, remaining: 1 });
    expect(r.error).toContain("324");
    expect(f.saves.at(-1)).toMatchObject({ status: "failed" });
  });

  it("an album that Meta refuses to create stays failed — no fallback to a multi-photo post", async () => {
    const f = fake({ createAlbum: async () => { throw new GraphError("Unsupported post request", 400, 100, 33); } });
    const r = await runAlbumPost(base(), f);
    expect(r.status).toBe("failed");
    expect(f.calls.filter((c) => c.startsWith("photo"))).toEqual([]);
  });

  it("a lost token says to reconnect", async () => {
    const f = fake({ createAlbum: async () => { throw new GraphError("expired", 400, 190, null); } });
    expect((await runAlbumPost(base(), f)).error).toContain("أعد ربط الصفحة");
  });
});
