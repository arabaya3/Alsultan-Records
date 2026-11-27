import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /p route outcomes with a simulated database and storage (no network): 404 vs 503 vs 504, 304 revalidation,
 * and the cache headers. The real stack is covered by the e2e specs (photos, album-covers, album-publishing-reels).
 */
/**
 * One simulated database: `published` is what both the anon RLS policy and public.album_photo_object_ref decide on
 * (the pgTAP test 98l_album_photo_ref_matches_rls.sql pins that they agree), `db` how the database answers.
 */
type Db = { published: boolean; db?: "ok" | "error" | "hang"; provider?: "supabase" | "s3" };
let dbState: Db = { published: true };
const calls = { from: 0, rpc: 0 };

function query(kind: "row" | "path") {
  let signal: AbortSignal | undefined;
  const settle = (): Promise<{ data: unknown; error: unknown }> => {
    const mode = dbState.db ?? "ok";
    if (mode === "hang")
      return new Promise((res) => signal?.addEventListener("abort", () => res({ data: null, error: { message: "AbortError: The operation was aborted." } })));
    if (mode === "error") return Promise.resolve({ data: null, error: { message: "connection refused", code: "PGRST000" } });
    if (kind === "row") return Promise.resolve({ data: dbState.published ? { id: PHOTO } : null, error: null });
    // Like the SQL function: no row unless the photo and its album are published.
    return Promise.resolve({ data: dbState.published ? [{ provider: dbState.provider ?? "supabase", path: "albums/a/b/thumb.webp" }] : [], error: null });
  };
  const b = {
    select: () => b,
    eq: () => b,
    abortSignal: (s: AbortSignal) => {
      signal = s;
      return b;
    },
    maybeSingle: settle,
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => settle().then(ok, ko),
  };
  return b;
}

vi.mock("@/features/public-content/client", () => ({
  getPublicClient: () => ({
    from: () => {
      calls.from++;
      return query("row");
    },
    rpc: () => {
      calls.rpc++;
      return query("path");
    },
  }),
}));

const s3Read = vi.fn();
vi.mock("@/lib/album-storage/s3", () => ({ s3Read: (...a: unknown[]) => s3Read(...a) }));

const PHOTO = "11111111-2222-4333-8444-555555555555";
const call = async (headers: Record<string, string> = {}) => {
  const { GET } = await import("./route");
  return GET(new Request(`http://x/p/${PHOTO}/thumb`, { headers }), { params: Promise.resolve({ photoId: PHOTO, variant: "thumb" }) });
};
const img = (status = 200, extra: Record<string, string> = {}) =>
  new Response(status === 200 ? new Uint8Array([1, 2, 3]) : null, { status, headers: { "content-type": "image/webp", etag: '"v1"', ...extra } });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon");
  dbState = { published: true };
  calls.from = 0;
  calls.rpc = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("/p/[photoId]/[variant]", () => {
  it("200: private, revalidated on every use (no-cache + ETag), never stored by a CDN", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => img()));
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-cache");
    expect(r.headers.get("cdn-cache-control")).toBe("no-store");
    expect(r.headers.get("etag")).toBe('"v1"');
  });

  it("one database round trip per request: the publication-checking RPC, no separate row read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => img()));
    expect((await call()).status).toBe(200);
    expect(calls).toEqual({ from: 0, rpc: 1 });
  });

  it("304: an unchanged photo is revalidated without the bytes — still only after the publication checks", async () => {
    const f = vi.fn(async () => new Response(null, { status: 304, headers: { etag: '"v1"' } }));
    vi.stubGlobal("fetch", f);
    const r = await call({ "if-none-match": '"v1"' });
    expect(r.status).toBe(304);
    expect(r.headers.get("cache-control")).toBe("private, no-cache");
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ "If-None-Match": '"v1"' });
  });

  it("withdrawn photo → 404 no-store even with the browser's ETag (no stale copy served)", async () => {
    dbState.published = false;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await call({ "if-none-match": '"v1"' });
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(f).not.toHaveBeenCalled();
  });

  it.each([400, 403, 404])("storage %i (missing / not allowed object) → 404", async (s) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: s })));
    expect((await call()).status).toBe(404);
  });

  it("storage 5xx → 503 no-store with Retry-After", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 502 })));
    const r = await call();
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("retry-after")).toBe("5");
  });

  it("database error → 503; storage network error → 503", async () => {
    dbState.db = "error";
    expect((await call()).status).toBe(503);
    dbState.db = "ok";
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect((await call()).status).toBe(503);
  });

  it("database hangs → 504 at the deadline (no endless request)", async () => {
    vi.useFakeTimers();
    dbState.db = "hang";
    const p = call();
    await vi.advanceTimersByTimeAsync(8001);
    const r = await p;
    expect(r.status).toBe(504);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("storage never answers → 504 at the deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
      ),
    );
    const p = call();
    await vi.advanceTimersByTimeAsync(8001);
    expect((await p).status).toBe(504);
  });

  it("an error body that never ends does not hold the response open", async () => {
    const body = new ReadableStream({ cancel: () => new Promise(() => {}) }); // cancel never settles
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 400 })));
    expect((await call()).status).toBe(404);
  });

  it("non-image content → 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => img(200, { "content-type": "text/html" })));
    expect((await call()).status).toBe(404);
  });
});

describe("/p on S3", () => {
  const body = () => new Blob([new Uint8Array([1, 2, 3])]).stream();
  beforeEach(() => {
    s3Read.mockReset();
    dbState = { published: true, provider: "s3" };
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Supabase must not be asked"); }));
  });

  it("200 with the same private, revalidated headers", async () => {
    s3Read.mockResolvedValue({ kind: "ok", body: body(), contentType: "image/webp", contentLength: 3, etag: '"v1"' });
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-cache");
    expect(r.headers.get("cdn-cache-control")).toBe("no-store");
    expect(r.headers.get("etag")).toBe('"v1"');
  });
  it("304 passes the browser's ETag, after the publication checks", async () => {
    s3Read.mockResolvedValue({ kind: "not-modified", etag: '"v1"' });
    const r = await call({ "if-none-match": '"v1"' });
    expect(r.status).toBe(304);
    expect(s3Read.mock.calls[0][1]).toMatchObject({ ifNoneMatch: '"v1"' });
  });
  it("withdrawn: storage is not even asked, and an ETag cannot earn a 304", async () => {
    dbState = { published: false, provider: "s3" };
    const r = await call({ "if-none-match": '"v1"' });
    expect(r.status).toBe(404);
    expect(s3Read).not.toHaveBeenCalled();
  });
  it("missing object → 404; storage error → 503; never cached", async () => {
    s3Read.mockResolvedValueOnce({ kind: "missing" });
    expect((await call()).status).toBe(404);
    s3Read.mockRejectedValueOnce(new Error("down"));
    const r = await call();
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("storage timing out → 504", async () => {
    const e = new Error("t");
    e.name = "AbortError";
    s3Read.mockRejectedValueOnce(e);
    expect((await call()).status).toBe(504);
  });
  it("an object that is not an image is not served", async () => {
    s3Read.mockResolvedValue({ kind: "ok", body: body(), contentType: "text/html" });
    expect((await call()).status).toBe(404);
  });
});
