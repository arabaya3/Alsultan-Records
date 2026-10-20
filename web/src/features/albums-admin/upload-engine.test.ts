import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AlbumUploadQueue race tests (review items 1 + 2). TUS and the server actions are replaced by controllable
 * fakes so cancel / reserve / resume / complete can be interleaved deterministically.
 */
const h = vi.hoisted(() => {
  type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
  const deferred = <T,>(): Deferred<T> => {
    let resolve!: (v: T) => void, reject!: (e: unknown) => void;
    const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
    return { promise, resolve, reject };
  };
  class FakeUpload {
    static all: FakeUpload[] = [];
    started = false;
    aborted: boolean | null = null;
    prev = deferred<unknown[]>();
    constructor(
      public file: File,
      public opts: { metadata: { objectName: string }; onProgress?: (s: number, t: number) => void; onSuccess?: () => void; onError?: (e: Error) => void },
    ) {
      FakeUpload.all.push(this);
    }
    get path() {
      return this.opts.metadata.objectName;
    }
    findPreviousUploads() {
      return this.prev.promise;
    }
    resumeFromPreviousUpload() {}
    start() {
      this.started = true;
    }
    abort(term?: boolean) {
      this.aborted = !!term;
      return Promise.resolve();
    }
    progress(n: number) {
      this.opts.onProgress?.(n, this.file.size);
    }
    succeed() {
      this.opts.onSuccess?.();
    }
    fail(status = 500) {
      const e = Object.assign(new Error("x"), { originalResponse: { getStatus: () => status } });
      this.opts.onError?.(e);
    }
  }
  return { deferred, FakeUpload };
});

vi.mock("tus-js-client", () => ({ Upload: h.FakeUpload }));
vi.mock("@/lib/env/public", () => ({ publicEnv: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk_test_xxxxxxxxxxxxxxxxxxxxxxxx" } }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }) }));

type Status = { id: string; status: string; error: string | null; attempts: number };
const server = vi.hoisted(() => ({
  photos: new Map<string, string>(), // photoId → upload_status ("uploading" | "pending" | "ready" | "failed")
  bySha: new Map<string, string>(),
  reserveGate: null as null | Promise<unknown>,
  completeGate: null as null | Promise<unknown>,
  canceled: [] as string[],
  completed: [] as string[],
  pollCalls: 0,
  retry: null as null | (() => Promise<Status[]>),
  nextId: 1,
}));

vi.mock("./actions", () => ({
  reserveAlbumUpload: vi.fn(async (_album: string, f: { sha256: string; name: string }) => {
    if (server.reserveGate) await server.reserveGate;
    const known = server.bySha.get(f.sha256);
    if (known) {
      const st = server.photos.get(known);
      if (st === "uploading") return { ok: true, photoId: known, path: `albums/a/${known}/original.jpg`, contentType: "image/jpeg", resumed: true };
      if (st === "failed-noobj") {
        server.photos.set(known, "uploading");
        return { ok: true, photoId: known, path: `albums/a/${known}/original.jpg`, contentType: "image/jpeg", resumed: true };
      }
      return { ok: false, skipped: true, photoId: known, message: "الصورة موجودة في هذا الألبوم — تم تخطيها." };
    }
    const id = `00000000-0000-4000-8000-${String(server.nextId++).padStart(12, "0")}`;
    server.photos.set(id, "uploading");
    server.bySha.set(f.sha256, id);
    return { ok: true, photoId: id, path: `albums/a/${id}/original.jpg`, contentType: "image/jpeg", resumed: false };
  }),
  completeAlbumUpload: vi.fn(async (id: string) => {
    if (server.completeGate) await server.completeGate;
    if (server.photos.get(id) !== "uploading") return { ok: false, message: "gone" };
    server.photos.set(id, "pending");
    server.completed.push(id);
    return { ok: true };
  }),
  cancelAlbumUpload: vi.fn(async (id: string) => {
    server.canceled.push(id);
    if (server.photos.get(id) === "uploading") {
      server.photos.delete(id);
      for (const [k, v] of server.bySha) if (v === id) server.bySha.delete(k);
    }
  }),
  getPhotoStatuses: vi.fn(async (_a: string, ids: string[]) => {
    server.pollCalls++;
    return ids.filter((id) => server.photos.has(id)).map((id) => {
      const s = server.photos.get(id)!;
      return { id, status: s === "pending" ? "ready" : s.startsWith("failed") ? "failed" : s, error: s.startsWith("failed") ? "original not found in storage" : null, attempts: 1 };
    });
  }),
  retryPhoto: vi.fn(async () => (server.retry ? server.retry() : [])),
}));

const { AlbumUploadQueue } = await import("./upload-engine");
type Q = InstanceType<typeof AlbumUploadQueue>;

const jpeg = (name: string, n = 0) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n & 255, (n >> 8) & 255, ...new Array(200).fill(7)])], name, { type: "image/jpeg", lastModified: 1 });
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean, what = "condition", ms = 3000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}
const uploads = () => h.FakeUpload.all;
async function finishAll() {
  // Every started, non-aborted upload succeeds (repeatedly, as new ones start).
  for (let i = 0; i < 50; i++) {
    for (const u of uploads()) {
      u.prev.resolve([]);
      const x = u as unknown as { done?: boolean };
      if (u.started && u.aborted === null && !x.done) {
        x.done = true;
        u.succeed();
      }
    }
    await tick();
  }
}

let q: Q;
let snap: { key: string; state: string; photoId?: string; name: string }[] = [];
let changes = 0;
beforeEach(() => {
  h.FakeUpload.all = [];
  Object.assign(server, { photos: new Map(), bySha: new Map(), reserveGate: null, completeGate: null, canceled: [], completed: [], pollCalls: 0, retry: null, nextId: 1 });
  changes = 0;
  q = new AlbumUploadQueue("00000000-0000-4000-8000-0000000000aa", (i) => ((snap = i), changes++), () => {}, 3, { pollMs: 5 });
});
afterEach(() => q.dispose());

const startedCount = () => uploads().filter((u) => u.started).length;
const states = () => snap.map((s) => s.state);

describe("cancel frees the concurrency slot (item 1)", () => {
  it("6 files: cancelling one of the 3 active starts the 4th; the rest finish", async () => {
    q.add([0, 1, 2, 3, 4, 5].map((i) => jpeg(`f${i}.jpg`, i)));
    await until(() => uploads().length === 3, "3 uploads");
    for (const u of uploads()) u.prev.resolve([]);
    await until(() => startedCount() === 3, "3 started");
    q.cancel(snap[1].key);
    await until(() => uploads().length === 4, "4th upload after cancel");
    await finishAll();
    await until(() => states().filter((s) => s === "ready").length === 5, "5 ready");
    expect(states()[1]).toBe("canceled");
  });

  it("cancelling all 3 active lets the waiting ones run", async () => {
    q.add([0, 1, 2, 3, 4, 5].map((i) => jpeg(`f${i}.jpg`, i)));
    await until(() => uploads().length === 3, "3 uploads");
    for (const u of uploads()) u.prev.resolve([]);
    await until(() => startedCount() === 3, "3 started");
    for (const k of snap.slice(0, 3).map((s) => s.key)) q.cancel(k);
    await finishAll();
    await until(() => states().filter((s) => s === "ready").length === 3, "3 ready");
    expect(states().slice(0, 3)).toEqual(["canceled", "canceled", "canceled"]);
    expect(server.canceled.length).toBe(3);
  });

  it("cancel all, then a new batch in the same editor uploads", async () => {
    q.add([0, 1, 2, 3, 4].map((i) => jpeg(`f${i}.jpg`, i)));
    await until(() => uploads().length === 3, "3 uploads");
    q.cancelAll();
    q.add([10, 11, 12, 13].map((i) => jpeg(`g${i}.jpg`, i)));
    await finishAll();
    await until(() => states().filter((s) => s === "ready").length === 4, "new batch ready");
    expect(states().filter((s) => s === "canceled").length).toBe(5);
  });

  it("cancel while the reservation is in flight: the late reservation is released, no TUS starts", async () => {
    const gate = h.deferred<void>();
    server.reserveGate = gate.promise;
    q.add([jpeg("a.jpg", 1), jpeg("b.jpg", 2)]);
    await until(() => states()[0] === "checking" && states()[1] === "checking", "checking");
    await new Promise((r) => setTimeout(r, 20)); // hash done, reserve pending
    q.cancel(snap[0].key);
    gate.resolve();
    await until(() => server.canceled.length === 1, "late reservation released");
    await finishAll();
    await until(() => states()[1] === "ready", "b ready");
    expect(states()[0]).toBe("canceled");
    expect(uploads().length).toBe(1); // only b
    expect([...server.photos.values()]).toEqual(["pending"]); // no orphan `uploading` row
  });

  it("cancel during findPreviousUploads: the upload is never started", async () => {
    q.add([jpeg("a.jpg", 1)]);
    await until(() => uploads().length === 1, "upload created");
    q.cancel(snap[0].key);
    uploads()[0].prev.resolve([]);
    await tick();
    await tick();
    expect(uploads()[0].started).toBe(false);
    expect(server.canceled.length).toBe(1);
    expect(server.photos.size).toBe(0);
  });

  it("cancel at 99 %: a late onSuccess does not complete or revive the file", async () => {
    q.add([jpeg("a.jpg", 1), jpeg("b.jpg", 2)]);
    await until(() => uploads().length === 2, "2 uploads");
    for (const u of uploads()) u.prev.resolve([]);
    await until(() => startedCount() === 2, "started");
    uploads()[0].progress(190);
    q.cancel(snap[0].key);
    uploads()[0].succeed(); // callback that raced the abort
    await finishAll();
    await until(() => states()[1] === "ready", "b ready");
    expect(states()[0]).toBe("canceled");
    expect(server.completed).toHaveLength(1);
    expect(server.photos.size).toBe(1);
  });

  it("cancel while completing: the confirmed original is kept and processed", async () => {
    const gate = h.deferred<void>();
    server.completeGate = gate.promise;
    q.add([jpeg("a.jpg", 1)]);
    await until(() => uploads().length === 1, "upload");
    uploads()[0].prev.resolve([]);
    await until(() => startedCount() === 1, "started");
    uploads()[0].succeed();
    await tick();
    q.cancel(snap[0].key);
    gate.resolve();
    await until(() => states()[0] === "ready", "ready");
    expect(server.canceled).toHaveLength(0);
  });

  it("dispose stops everything: no new files start and no updates are emitted", async () => {
    q.add([0, 1, 2, 3, 4].map((i) => jpeg(`f${i}.jpg`, i)));
    await until(() => uploads().length === 3, "3 uploads");
    q.dispose();
    const before = changes;
    for (const u of uploads()) {
      u.prev.resolve([]);
      u.succeed();
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(uploads().length).toBe(3);
    expect(uploads().every((u) => u.aborted === false || !u.started)).toBe(true); // stopped, resumable
    expect(changes).toBe(before);
    expect(server.completed).toHaveLength(0);
  });

  it("an un-mounted editor (dispose then attach, e.g. React StrictMode) carries on", async () => {
    q.add([jpeg("a.jpg", 1)]);
    q.dispose();
    q.attach();
    await finishAll();
    await until(() => states()[0] === "ready", "ready after re-attach");
  });
});

describe("previous-session rows merge with re-chosen files (item 2)", () => {
  const prev = (id: string, status: string, error: string | null = null) => ({ id, status, error, attempts: 1 }) as never;

  async function seedUploadingFromEarlierSession(file: File) {
    const { reserveAlbumUpload } = await import("./actions");
    const sha = (await import("./rules")).fileSha256;
    const r = (await reserveAlbumUpload("x", { name: file.name, size: file.size, sha256: await sha(file), format: "jpeg" })) as { photoId: string };
    return r.photoId;
  }

  it("reload with an unfinished upload, then re-choose the same file: one row, ends ready", async () => {
    const f = jpeg("a.jpg", 1);
    const id = await seedUploadingFromEarlierSession(f);
    q.addPrevious([prev(id, "uploading")]);
    q.add([f]);
    await finishAll();
    await until(() => snap.some((s) => s.state === "ready"), "ready");
    expect(snap.filter((s) => s.photoId === id)).toHaveLength(1);
    expect(snap).toHaveLength(1);
  });

  it("the getUnfinishedPhotos answer arrives after the upload already started: still one row", async () => {
    const f = jpeg("a.jpg", 1);
    const id = await seedUploadingFromEarlierSession(f);
    q.add([f]);
    await until(() => uploads().length === 1, "upload started");
    q.addPrevious([prev(id, "uploading")]);
    await finishAll();
    await until(() => snap.some((s) => s.state === "ready"), "ready");
    expect(snap).toHaveLength(1);
  });

  it("a failed row whose original was never stored (the 67-photo case) is reopened in place", async () => {
    const f = jpeg("a.jpg", 1);
    const id = await seedUploadingFromEarlierSession(f);
    server.photos.set(id, "failed-noobj");
    q.addPrevious([prev(id, "failed", "original not found in storage")]);
    q.add([f]);
    await finishAll();
    await until(() => snap.some((s) => s.state === "ready"), "ready");
    expect(snap).toHaveLength(1);
    expect(snap[0].photoId).toBe(id);
  });

  it("original stored but processing failed: re-choosing does not duplicate; retry reaches a final state", async () => {
    const f = jpeg("a.jpg", 1);
    const id = await seedUploadingFromEarlierSession(f);
    server.photos.set(id, "failed");
    q.addPrevious([prev(id, "failed", "variant upload failed")]);
    q.add([f]);
    await until(() => snap.length === 1 && snap[0].state === "failed" && !uploads().length, "merged into the failed row");
    server.retry = async () => {
      server.photos.set(id, "pending");
      return [{ id, status: "processing", error: null, attempts: 0 }];
    };
    await q.retry(snap[0].key);
    await until(() => snap[0].state === "ready", "ready");
    expect(snap).toHaveLength(1);
  });

  it("a failing retry request does not leave the row «processing» forever", async () => {
    q.addPrevious([prev("00000000-0000-4000-8000-000000000999", "failed", "variant upload failed")]);
    server.retry = async () => {
      throw new Error("network");
    };
    await q.retry(snap[0].key);
    await until(() => snap[0].state === "failed", "failed again");
  });

  it("polling stops once nothing is processing, and polls each photo once", async () => {
    q.add([jpeg("a.jpg", 1)]);
    await finishAll();
    await until(() => snap[0].state === "ready", "ready");
    const n = server.pollCalls;
    await new Promise((r) => setTimeout(r, 40));
    expect(server.pollCalls).toBe(n);
  });

  it("a processing photo that disappeared (deleted elsewhere) stops polling as failed", async () => {
    q.addPrevious([prev("00000000-0000-4000-8000-000000000998", "processing")]);
    await until(() => snap[0].state === "failed", "failed");
    const n = server.pollCalls;
    await new Promise((r) => setTimeout(r, 40));
    expect(server.pollCalls).toBe(n);
  });
});
