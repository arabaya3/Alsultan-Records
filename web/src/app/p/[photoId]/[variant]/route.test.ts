import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /p route outcomes with a simulated database and storage (no network): 404 vs 503 vs 504, 304 revalidation,
 * and the cache headers. The real stack is covered by the e2e specs (photos, album-covers, album-publishing-reels).
 */
type Db = { row: "yes" | "no" | "error" | "hang"; path?: "ok" | "error" | "hang" };
let dbState: Db = { row: "yes", path: "ok" };

function query(kind: "row" | "path") {
  let signal: AbortSignal | undefined;
  const settle = (): Promise<{ data: unknown; error: unknown }> => {
    const mode = kind === "row" ? dbState.row : (dbState.path ?? "ok");
    if (mode === "hang")
      return new Promise((res) => signal?.addEventListener("abort", () => res({ data: null, error: { message: "AbortError: The operation was aborted." } })));
    if (mode === "error") return Promise.resolve({ data: null, error: { message: "connection refused", code: "PGRST000" } });
    if (kind === "row") return Promise.resolve({ data: mode === "yes" ? { id: PHOTO } : null, error: null });
    return Promise.resolve({ data: "albums/a/b/thumb.webp", error: null });
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
  getPublicClient: () => ({ from: () => query("row"), rpc: () => query("path") }),
}));

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
  dbState = { row: "yes", path: "ok" };
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

  it("304: an unchanged photo is revalidated without the bytes — still only after the publication checks", async () => {
    const f = vi.fn(async () => new Response(null, { status: 304, headers: { etag: '"v1"' } }));
    vi.stubGlobal("fetch", f);
    const r = await call({ "if-none-match": '"v1"' });
    expect(r.status).toBe(304);
    expect(r.headers.get("cache-control")).toBe("private, no-cache");
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ "If-None-Match": '"v1"' });
  });

  it("withdrawn photo → 404 no-store even with the browser's ETag (no stale copy served)", async () => {
    dbState.row = "no";
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
    dbState.row = "error";
    expect((await call()).status).toBe(503);
    dbState.row = "yes";
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect((await call()).status).toBe(503);
  });

  it("database hangs → 504 at the deadline (no endless request)", async () => {
    vi.useFakeTimers();
    dbState.row = "hang";
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
